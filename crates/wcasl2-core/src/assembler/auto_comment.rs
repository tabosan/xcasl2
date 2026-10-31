use super::{assemble_sources_impl, operands, register};
use crate::encode_cp932;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CommentEdit {
    pub line: usize,
    pub text: String,
}

/// Plan line edits using the assembler's syntax, scope and linker diagnostics.
/// Does not create a simulation or modify any source, memory or device state.
pub fn auto_comments(
    sources: &[(Option<&str>, &str)],
    target: Option<&str>,
    base: u16,
    overwrite: bool,
) -> Vec<CommentEdit> {
    let Some((_, source)) = sources.iter().find(|(file, _)| *file == target) else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    let diagnostics = assemble_sources_impl(sources, base, Some(&mut rows))
        .err()
        .unwrap_or_default();
    if diagnostics
        .iter()
        .any(|d| d.line == 0 && (d.file.is_none() || d.file.as_deref() == target))
    {
        return Vec::new();
    }
    let invalid: BTreeSet<_> = diagnostics
        .iter()
        .filter(|d| d.file.as_deref() == target)
        .map(|d| d.line)
        .collect();
    let addresses: BTreeMap<_, _> = rows
        .into_iter()
        .filter(|r| r.file.as_deref() == target)
        .map(|r| (r.line, r.address))
        .collect();
    source
        .split('\n')
        .enumerate()
        .filter_map(|(i, raw)| {
            let line = i + 1;
            let address = *addresses.get(&line)?;
            let raw = raw.strip_suffix('\r').unwrap_or(raw);
            if invalid.contains(&line) || (!overwrite && raw.contains(';')) {
                return None;
            }
            let code = raw.split(';').next()?.trim_end_matches([' ', '\t']);
            let comment = template(code, address)?;
            let text = format!("{code}\t;{comment}");
            // Adding a comment must not turn a valid line into a CP932/length error.
            if text == raw || encode_cp932(&text).ok()?.len() > 200 {
                return None;
            }
            Some(CommentEdit { line, text })
        })
        .collect()
}

fn template(code: &str, address: u16) -> Option<String> {
    let indented = code.starts_with([' ', '\t']);
    let mut tail = code.trim_start_matches([' ', '\t']);
    let mut name = "";
    if !indented {
        let end = tail.find([' ', '\t']).unwrap_or(tail.len());
        name = &tail[..end];
        tail = tail[end..].trim_start_matches([' ', '\t']);
    }
    let end = tail.find([' ', '\t']).unwrap_or(tail.len());
    let op = &tail[..end];
    let operand = tail[end..].trim_start_matches([' ', '\t']);
    let args = operands(operand).ok()?;
    let arg = |index: usize| args.get(index).copied().unwrap_or("");
    let effective = |offset: usize, separator: &str| {
        if args.len() > offset + 1 {
            format!("{}{separator}{}", arg(offset), arg(offset + 1))
        } else {
            arg(offset).to_owned()
        }
    };
    let value = || {
        if args.len() == 2 && register(arg(1)).is_ok() {
            arg(1).to_owned()
        } else {
            format!("({})", effective(1, " + "))
        }
    };
    Some(match op {
        "LD" => format!("{} <- {}", arg(0), value()),
        "LAD" => format!("{} <- {}", arg(0), effective(1, " + ")),
        "ST" => format!("<{}> <- {}", effective(1, "+"), arg(0)),
        "DC" => format!(
            "<{}> <- {operand}",
            if name.is_empty() {
                format!("#{address:04X}")
            } else {
                name.to_owned()
            }
        ),
        "DS" => {
            if name.is_empty() {
                format!("allocate {operand} words at #{address:04X}")
            } else {
                format!("allocate {operand} words for {name}")
            }
        }
        "ADDA" | "ADDL" | "SUBA" | "SUBL" | "AND" | "OR" | "XOR" => {
            let operator = match op {
                "ADDA" | "ADDL" => "+",
                "SUBA" | "SUBL" => "-",
                _ => op,
            };
            format!("{} <- {} {operator} {}", arg(0), arg(0), value())
        }
        "SLA" | "SLL" | "SRA" | "SRL" => {
            let operator = if matches!(op, "SLA" | "SLL") {
                "<<"
            } else {
                ">>"
            };
            format!(
                "{} <- {} {operator} {}",
                arg(0),
                arg(0),
                effective(1, " + ")
            )
        }
        "CPA" | "CPL" => format!("{} : {}", arg(0), value()),
        "JUMP" | "CALL" => format!("goto {}", effective(0, " + ")),
        "JPL" | "JMI" | "JNZ" | "JZE" | "JOV" => {
            let condition = match op {
                "JPL" => "SF=0 & ZF=0",
                "JMI" => "SF=1",
                "JNZ" => "ZF=0",
                "JZE" => "ZF=1",
                _ => "OF=1",
            };
            format!("{condition} then goto {}", effective(0, " + "))
        }
        "PUSH" => format!("SP <- SP - 1, <SP> <- {}", effective(0, " + ")),
        "POP" => format!("(SP) -> {}, SP <- SP + 1", arg(0)),
        // In particular, never remove an existing comment on these operations.
        _ => return None,
    })
}
