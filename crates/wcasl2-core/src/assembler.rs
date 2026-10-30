use crate::{encode_cp932, Machine, MEMORY_WORDS};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
pub struct Diagnostic {
    pub file: Option<String>,
    pub line: usize,
    pub code: u16,
    pub message: String,
}

fn diagnostic(line: usize, code: u16, message: impl Into<String>) -> Diagnostic {
    Diagnostic {
        file: None,
        line,
        code,
        message: message.into(),
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SourceRow {
    pub file: Option<String>,
    pub line: usize,
    pub address: u16,
    pub words: u16,
    pub source: String,
}

#[derive(Clone, Debug)]
pub struct Image {
    pub entry: u16,
    pub program_end: u16,
    pub words: Vec<Option<u16>>,
    pub base: u16,
    pub rows: Vec<SourceRow>,
    pub labels: BTreeMap<String, u16>,
    pub symbols: Vec<LabelInfo>,
}

/// Display metadata; zero-word labels designate code rather than data.
#[derive(Clone, Debug, Serialize)]
pub struct LabelInfo {
    pub name: String,
    pub scope: String,
    pub file: Option<String>,
    pub line: usize,
    pub address: u16,
    pub words: u16,
}

impl Image {
    pub fn load(&self, fill: u16) -> Machine {
        let mut machine = Machine::new(fill, self.entry, self.program_end.wrapping_add(129));
        for (offset, word) in self.words.iter().enumerate() {
            if let Some(word) = word {
                machine.write(self.base.wrapping_add(offset as u16), *word);
            }
        }
        machine
    }
}

#[derive(Clone)]
enum Value {
    Number(u16),
    Name(String),
}

struct Fixup {
    offset: usize,
    name: String,
    line: usize,
}
struct Literal {
    spelling: String,
    values: Vec<Value>,
}
struct Section {
    file: Option<String>,
    base: u16,
    words: Vec<Option<u16>>,
    labels: BTreeMap<String, u16>,
    public: Option<String>,
    entry: Option<String>,
    fixups: Vec<Fixup>,
    literals: Vec<Literal>,
    rows: Vec<SourceRow>,
    symbols: Vec<LabelInfo>,
}

impl Section {
    fn new(base: u16) -> Self {
        Self {
            file: None,
            base,
            words: Vec::new(),
            labels: BTreeMap::new(),
            public: None,
            entry: None,
            fixups: Vec::new(),
            literals: Vec::new(),
            rows: Vec::new(),
            symbols: Vec::new(),
        }
    }
    fn address(&self) -> u16 {
        self.base.wrapping_add(self.words.len() as u16)
    }
    fn word(&mut self, word: u16) {
        self.words.push(Some(word));
    }
    fn value(&mut self, value: Value, line: usize) {
        match value {
            Value::Number(value) => self.word(value),
            Value::Name(name) => {
                self.fixups.push(Fixup {
                    offset: self.words.len(),
                    name,
                    line,
                });
                self.word(0);
            }
        }
    }
    fn address_value(&mut self, text: &str) -> Result<Value, (u16, String)> {
        if let Some(text) = text.strip_prefix('=') {
            let values = constants(text)?;
            if values.iter().any(|value| matches!(value, Value::Name(_))) {
                return Err((8, "アドレス型リテラルは初版では未対応です。".into()));
            }
            let spelling = format!("={text}");
            if !self
                .literals
                .iter()
                .any(|literal| literal.spelling == spelling)
            {
                self.literals.push(Literal {
                    spelling: spelling.clone(),
                    values,
                });
            }
            Ok(Value::Name(spelling))
        } else {
            scalar(text)
        }
    }
    fn finish(&mut self) {
        for literal in std::mem::take(&mut self.literals) {
            self.symbols.push(LabelInfo {
                name: literal.spelling.clone(),
                scope: String::new(),
                file: self.file.clone(),
                line: 0,
                address: self.address(),
                words: literal.values.len() as u16,
            });
            self.labels.insert(literal.spelling, self.address());
            for value in literal.values {
                self.value(value, 0);
            }
        }
    }
}

fn label(text: &str) -> Result<(), (u16, String)> {
    let bytes = encode_cp932(text).map_err(|error| (3, error))?;
    if bytes.len() > 8 {
        return Err((2, "ラベルが長すぎます。".into()));
    }
    if !bytes.first().is_some_and(u8::is_ascii_uppercase) {
        return Err((3, "ラベルの文字が不正です。".into()));
    }
    if register(text).is_ok() {
        return Err((12, "レジスタ名をラベルには使えません。".into()));
    }
    // The original mistakenly validates the first character again for subsequent characters.
    Ok(())
}

fn register(text: &str) -> Result<usize, (u16, String)> {
    match text.as_bytes() {
        [b'G', b'R', digit @ b'0'..=b'7'] => Ok((digit - b'0') as usize),
        _ => Err((5, "GRレジスタのエラーです。".into())),
    }
}

fn index(text: &str) -> Result<usize, (u16, String)> {
    match register(text) {
        Ok(value @ 1..=7) => Ok(value),
        _ => Err((6, "XRレジスタのエラーです。".into())),
    }
}

fn scalar(text: &str) -> Result<Value, (u16, String)> {
    if let Some(hex) = text.strip_prefix('#') {
        if hex.len() == 4
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte))
        {
            return Ok(Value::Number(u16::from_str_radix(hex, 16).unwrap()));
        }
    } else if !text.is_empty()
        && text
            .strip_prefix('-')
            .unwrap_or(text)
            .bytes()
            .all(|byte| byte.is_ascii_digit())
    {
        if let Ok(number) = text.parse::<i64>() {
            return Ok(Value::Number(number.max(-32768) as u16));
        }
    } else if text.starts_with('+')
        && text[1..].bytes().all(|byte| byte.is_ascii_digit())
        && text.len() > 1
    {
        // The assembly stage accepts this spelling, but the observed linker treats it as a name.
        return Ok(Value::Name(text.into()));
    } else if label(text).is_ok() && !text.chars().any(char::is_whitespace) {
        return Ok(Value::Name(text.into()));
    }
    Err((8, "オペランドのエラーです。".into()))
}

/// Split commas outside apostrophe strings. Doubled apostrophes represent one apostrophe.
fn operands(text: &str) -> Result<Vec<&str>, (u16, String)> {
    let mut quoted = false;
    let mut start = 0;
    let mut result = Vec::new();
    for (offset, character) in text.char_indices() {
        if character == '\'' {
            quoted = !quoted;
        }
        if character == ',' && !quoted {
            result.push(&text[start..offset]);
            start = offset + 1;
        }
    }
    if quoted {
        return Err((8, "文字列が閉じられていません。".into()));
    }
    result.push(&text[start..]);
    Ok(result)
}

fn constants(text: &str) -> Result<Vec<Value>, (u16, String)> {
    let mut result = Vec::new();
    for item in operands(text)? {
        if item.starts_with('\'') && item.ends_with('\'') && item.len() >= 2 {
            let inner = &item[1..item.len() - 1];
            let mut chars = inner.chars().peekable();
            let mut unescaped = String::new();
            while let Some(character) = chars.next() {
                if character == '\'' && chars.next() != Some('\'') {
                    return Err((8, "文字列中のアポストロフィは2個続けてください。".into()));
                }
                unescaped.push(character);
            }
            let bytes = encode_cp932(&unescaped).map_err(|error| (8, error))?;
            result.extend(
                bytes
                    .into_iter()
                    .map(|byte| Value::Number(byte as i8 as i16 as u16)),
            );
        } else {
            result.push(scalar(item)?);
        }
    }
    Ok(result)
}

fn emit_instruction(
    section: &mut Section,
    op: &str,
    operand: &str,
    line: usize,
) -> Result<(), (u16, String)> {
    let args = operands(operand)?;
    let error = || (8, "オペランドのエラーです。".into());
    let mut emit = |opcode: u16, r: usize, x: usize, address: Option<Value>| {
        section.word((opcode << 8) | ((r as u16) << 4) | x as u16);
        if let Some(address) = address {
            section.value(address, line);
        }
    };
    match op {
        "NOP" | "RET" => {
            if !operand.is_empty() {
                return Err(error());
            }
            emit(if op == "NOP" { 0 } else { 0x81 }, 0, 0, None);
        }
        "POP" => {
            if args.len() != 1 {
                return Err(error());
            }
            let r = register(args[0])?;
            emit(0x71, r, 0, None);
        }
        "RPUSH" => {
            for r in 1..=7 {
                emit(0x70, 0, r, Some(Value::Number(0)));
            }
        }
        "RPOP" => {
            for r in (1..=7).rev() {
                emit(0x71, r, 0, None);
            }
        }
        "IN" | "OUT" => {
            if args.len() != 2 || args.iter().any(|arg| label(arg).is_err()) {
                return Err(error());
            }
            emit(0x70, 0, 1, Some(Value::Number(0)));
            emit(0x70, 0, 2, Some(Value::Number(0)));
            emit(0x12, 1, 0, Some(Value::Name(args[0].into())));
            emit(0x12, 2, 0, Some(Value::Name(args[1].into())));
            emit(
                0xf0,
                0,
                0,
                Some(Value::Number(if op == "IN" { 1 } else { 2 })),
            );
            emit(0x71, 2, 0, None);
            emit(0x71, 1, 0, None);
        }
        _ => {
            let (opcode, has_register, register_form) = match op {
                "LD" => (0x10, true, true),
                "ST" => (0x11, true, false),
                "LAD" => (0x12, true, false),
                "ADDA" => (0x20, true, true),
                "SUBA" => (0x21, true, true),
                "ADDL" => (0x22, true, true),
                "SUBL" => (0x23, true, true),
                "AND" => (0x30, true, true),
                "OR" => (0x31, true, true),
                "XOR" => (0x32, true, true),
                "CPA" => (0x40, true, true),
                "CPL" => (0x41, true, true),
                "SLA" => (0x50, true, false),
                "SRA" => (0x51, true, false),
                "SLL" => (0x52, true, false),
                "SRL" => (0x53, true, false),
                "JMI" => (0x61, false, false),
                "JNZ" => (0x62, false, false),
                "JZE" => (0x63, false, false),
                "JUMP" => (0x64, false, false),
                "JPL" => (0x65, false, false),
                "JOV" => (0x66, false, false),
                "PUSH" => (0x70, false, false),
                "CALL" => (0x80, false, false),
                "SVC" => (0xf0, false, false),
                _ => return Err((7, "命令コードのエラーです。".into())),
            };
            let offset = usize::from(has_register);
            if args.len() < 1 + offset || args.len() > 2 + offset {
                return Err(error());
            }
            let r = if has_register { register(args[0])? } else { 0 };
            if register_form {
                if let Ok(r2) = register(args[offset]) {
                    if args.len() != offset + 1 {
                        return Err((13, "2レジスタ型に指標レジスタは指定できません。".into()));
                    }
                    emit(opcode + 4, r, r2, None);
                    return Ok(());
                }
            }
            let x = if args.len() == 2 + offset {
                index(args[1 + offset])?
            } else {
                0
            };
            // Release the emitter's mutable borrow before interning a literal.
            let value = section.address_value(args[offset])?;
            section.word((opcode << 8) | ((r as u16) << 4) | x as u16);
            section.value(value, line);
        }
    }
    Ok(())
}

pub fn assemble(source: &str, base: u16) -> Result<Image, Vec<Diagnostic>> {
    assemble_sources(&[(None, source)], base)
}

/// Each file is parsed independently; only START names are shared by the linker.
pub fn assemble_sources(
    sources: &[(Option<&str>, &str)],
    base: u16,
) -> Result<Image, Vec<Diagnostic>> {
    let mut errors = Vec::new();
    let mut sections = Vec::new();
    if sources.is_empty() {
        return Err(vec![diagnostic(0, 11, "ソースプログラムがありません。")]);
    }
    for (file, source) in sources {
        let first_error = errors.len();
        let mut section = Section::new(sections.last().map_or(base, |s: &Section| s.address()));
        section.file = file.map(str::to_owned);
        let mut ended = false;
        let mut lines: Vec<&str> = source.split('\n').collect();
        // A final line separator is not itself an empty source statement.
        if source.ends_with('\n') {
            lines.pop();
        }
        while lines.last().is_some_and(|line| line.trim().is_empty()) {
            lines.pop();
        }
        if lines.is_empty() {
            let mut error = diagnostic(0, 11, "ソースプログラムがありません。");
            error.file = file.map(str::to_owned);
            errors.push(error);
            continue;
        }
        if lines.len() > 2000 {
            let mut error = diagnostic(2001, 0, "初版のソース行数上限は2000行です。");
            error.file = file.map(str::to_owned);
            errors.push(error);
            continue;
        }
        for (i, raw) in lines.iter().enumerate() {
            let line = i + 1;
            let raw = raw.strip_suffix('\r').unwrap_or(raw);
            match encode_cp932(raw) {
                Err(error) => {
                    errors.push(diagnostic(line, 8, error));
                    continue;
                }
                Ok(bytes) if bytes.len() > 200 => {
                    errors.push(diagnostic(line, 0, "1行が長すぎます（200バイトまで）。"));
                    continue;
                }
                _ => (),
            }
            if ended {
                if raw.trim().is_empty() {
                    continue;
                }
                section = Section::new(sections.last().map_or(base, |s: &Section| s.address()));
                section.file = file.map(str::to_owned);
                ended = false;
            }
            // Original preprocessing cuts at semicolon even inside a string literal.
            let code = raw.split(';').next().unwrap().trim_end_matches([' ', '\t']);
            if code.is_empty() && raw.contains(';') {
                continue;
            }
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
            let address = section.address();
            let before = section.words.len();
            let parsed = (|| -> Result<(), (u16, String)> {
                if !name.is_empty() {
                    label(name)?;
                    if section.labels.contains_key(name) {
                        return Err((1, "ラベルが重複しています。".into()));
                    }
                    if section.labels.len() >= 200 {
                        return Err((0, "ラベル領域が不足しています。".into()));
                    }
                    section.labels.insert(name.into(), address);
                }
                match op {
                    "START" => {
                        if name.is_empty() {
                            return Err((4, "STARTのラベルがありません。".into()));
                        }
                        if section.public.is_some() || !section.words.is_empty() {
                            return Err((10, "STARTのエラーです。".into()));
                        }
                        section.public = Some(name.into());
                        if !operand.is_empty() {
                            label(operand)?;
                            section.entry = Some(operand.into());
                        }
                    }
                    "END" => {
                        if !operand.is_empty() {
                            return Err((8, "ENDにオペランドは指定できません。".into()));
                        }
                        ended = true;
                    }
                    "DS" => {
                        if operand.is_empty() || !operand.bytes().all(|byte| byte.is_ascii_digit())
                        {
                            return Err((8, "DSには非負の10進整数を指定してください。".into()));
                        }
                        let count = operand
                            .parse::<usize>()
                            .map_err(|_| (8, "DSのサイズが不正です。".into()))?;
                        if count > MEMORY_WORDS || section.words.len() + count > MEMORY_WORDS {
                            return Err((0, "メモリ領域が不足しています。".into()));
                        }
                        section.words.resize(section.words.len() + count, None);
                    }
                    "DC" => {
                        for value in constants(operand)? {
                            section.value(value, line);
                        }
                    }
                    _ => emit_instruction(&mut section, op, operand, line)?,
                }
                Ok(())
            })();
            if let Err((code, message)) = parsed {
                errors.push(diagnostic(line, code, message));
            }
            if !name.is_empty() {
                section.symbols.push(LabelInfo {
                    name: name.into(),
                    scope: String::new(),
                    file: file.map(str::to_owned),
                    line,
                    address,
                    words: if matches!(op, "DC" | "DS") {
                        (section.words.len() - before) as u16
                    } else {
                        0
                    },
                });
            }
            section.rows.push(SourceRow {
                file: file.map(str::to_owned),
                line,
                address,
                words: (section.words.len() - before) as u16,
                source: raw.to_string(),
            });
            if ended {
                section.finish();
                sections.push(section);
                section = Section::new(0);
            }
        }
        if !ended {
            errors.push(diagnostic(lines.len(), 0, "ENDがありません。"));
        }
        for error in &mut errors[first_error..] {
            error.file = file.map(str::to_owned);
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    let mut globals = BTreeMap::new();
    for section in &sections {
        if let Some(name) = &section.public {
            if globals.insert(name.clone(), section.base).is_some() {
                let mut error = diagnostic(0, 1, format!("公開名 {name} が重複しています。"));
                error.file = section.file.clone();
                errors.push(error);
            }
        }
    }
    let mut words = Vec::new();
    let mut rows = Vec::new();
    let mut labels = BTreeMap::new();
    let mut symbols = Vec::new();
    let mut entry = base;
    for (i, mut section) in sections.into_iter().enumerate() {
        if i == 0 {
            if let Some(name) = &section.entry {
                if let Some(address) = section.labels.get(name).or_else(|| globals.get(name)) {
                    entry = *address;
                } else {
                    let mut error =
                        diagnostic(0, 9, format!("開始ラベル {name} が見つかりません。"));
                    error.file = section.file.clone();
                    errors.push(error);
                }
            }
        }
        for fixup in section.fixups {
            match section
                .labels
                .get(&fixup.name)
                .or_else(|| globals.get(&fixup.name))
            {
                Some(value) => section.words[fixup.offset] = Some(*value),
                None => {
                    let mut error =
                        diagnostic(fixup.line, 9, format!("未解決の外部ラベル: {}", fixup.name));
                    error.file = section.file.clone();
                    errors.push(error);
                }
            }
        }
        let scope = section.public.as_deref().unwrap_or("(無名)");
        for mut symbol in section.symbols {
            symbol.scope = scope.into();
            symbols.push(symbol);
        }
        for (name, address) in section.labels {
            labels.insert(format!("{scope}:{name}"), address);
        }
        words.extend(section.words);
        rows.extend(section.rows);
    }
    let end = base as usize + words.len();
    if end > MEMORY_WORDS {
        errors.push(diagnostic(0, 0, "メモリ領域が不足しています。"));
    }
    if errors.is_empty() {
        Ok(Image {
            entry,
            base,
            program_end: end as u16,
            words,
            rows,
            labels,
            symbols,
        })
    } else {
        Err(errors)
    }
}
