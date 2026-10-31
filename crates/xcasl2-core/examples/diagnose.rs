//! Read-only execution trace for investigating a CP932 CASL source.
use std::collections::VecDeque;
use xcasl2_core::{assemble, decode_source, Session, Status};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("Usage: diagnose <source.cas>")?;
    let bytes = std::fs::read(&path)?;
    let source = decode_source(&bytes)?;
    let image = assemble(&source, 32).map_err(|errors| serde_json::to_string(&errors).unwrap())?;
    let labels = image.labels.clone();
    let rows = image.rows.clone();
    let mut session = Session::new(image, 65535);
    let initial = session.machine.memory.clone();
    let mut trace = VecDeque::new();
    while session.machine.status == Status::Ready && session.steps < 1_000_000 {
        let pc = session.machine.cpu.pr;
        let row = rows
            .iter()
            .find(|row| pc >= row.address && pc < row.address + row.words);
        trace.push_back(serde_json::json!({
            "step": session.steps, "pc": pc,
            "words": [session.machine.read(pc), session.machine.read(pc.wrapping_add(1))],
            "line": row.map(|row| row.line), "source": row.map(|row| &row.source),
            "cpu": session.machine.cpu,
        }));
        if trace.len() > 24 {
            trace.pop_front();
        }
        session.step();
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "path": path, "labels": labels, "initial_memory": initial,
            "trace": trace, "final": session.snapshot(),
        }))?
    );
    Ok(())
}
