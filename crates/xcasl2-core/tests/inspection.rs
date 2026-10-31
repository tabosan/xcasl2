use xcasl2_core::{assemble_sources, Session};

#[test]
fn data_label_spans_include_arrays_literals_and_distinct_scopes() {
    let image = assemble_sources(
        &[
            (Some("main.cas"), "MAIN START\nLOOP LD GR1,VAL\n LAD GR2,=7\n RET\nVAL DC -1,32767,-32768\nBUF DS 2\nEMPTY DS 0\n END\n"),
            (Some("sub.cas"), "SUB START\nVAL DC 9\n RET\n END\n"),
        ],
        32,
    ).unwrap();
    let data: Vec<_> = image
        .symbols
        .iter()
        .filter(|symbol| symbol.words > 0)
        .map(|symbol| {
            (
                symbol.scope.as_str(),
                symbol.name.as_str(),
                symbol.address,
                symbol.words,
                symbol.file.as_deref(),
                symbol.line,
            )
        })
        .collect();
    assert_eq!(
        data,
        vec![
            ("MAIN", "VAL", 37, 3, Some("main.cas"), 5),
            ("MAIN", "BUF", 40, 2, Some("main.cas"), 6),
            ("MAIN", "=7", 42, 1, Some("main.cas"), 0),
            ("SUB", "VAL", 43, 1, Some("sub.cas"), 2),
        ]
    );
    assert!(image
        .symbols
        .iter()
        .filter(|s| matches!(s.name.as_str(), "MAIN" | "LOOP" | "EMPTY"))
        .all(|s| s.words == 0));
    let snapshot = Session::new(image, 65535).snapshot();
    assert_eq!(snapshot.symbols.len(), 8);
    assert_eq!(
        &snapshot.memory[37..43],
        &[65535, 32767, 32768, 65535, 65535, 7]
    );
}

#[test]
fn inspection_reads_live_store_stack_and_reset_values() {
    let image = assemble_sources(&[(Some("main.cas"), "MAIN START\n LD GR1,NEG\n ST GR1,BUF\n PUSH 0,GR1\n POP GR2\n RET\nNEG DC -1\nBUF DS 1\n END\n")], 32).unwrap();
    let buffer = image
        .symbols
        .iter()
        .find(|s| s.name == "BUF")
        .unwrap()
        .address as usize;
    let mut session = Session::new(image, 0);
    let initial_sp = session.snapshot().cpu.sp;
    session.step();
    session.step();
    let stored = session.snapshot();
    assert_eq!(stored.memory[buffer], 65535);
    session.step();
    let pushed = session.snapshot();
    assert_eq!(pushed.cpu.sp, initial_sp - 1);
    assert_eq!(pushed.memory[pushed.cpu.sp as usize], 65535);
    session.step();
    assert_eq!(session.snapshot().cpu.sp, initial_sp);
    // Popping changes SP, but leaves the physical memory word visible.
    assert_eq!(session.snapshot().memory[(initial_sp - 1) as usize], 65535);
    session.reset();
    let reset = session.snapshot();
    assert_eq!(reset.memory[buffer], 0);
    assert_eq!(reset.memory[(initial_sp - 1) as usize], 0);
    assert_eq!(reset.symbols.len(), stored.symbols.len());
}
