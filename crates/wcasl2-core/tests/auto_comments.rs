use wcasl2_core::{assemble, assembler::auto_comments};

fn comment_for(statement: &str) -> String {
    let source = format!("MAIN START\n {statement}\n RET\nDATA DC 1234\nARR DC 1,2,3\nBUF DS 10\nLOOP NOP\nMUL RET\n END\n");
    assert!(assemble(&source, 32).is_ok(), "{statement}");
    auto_comments(&[(None, &source)], None, 32, false)
        .into_iter()
        .find(|e| e.line == 2)
        .unwrap()
        .text
}

#[test]
fn comments_describe_actual_operands_addresses_and_stack_effects() {
    for (instruction, expected) in [
        ("LAD GR1,DATA", "GR1 <- DATA"),
        ("LAD GR1,DATA,GR2", "GR1 <- DATA + GR2"),
        ("LD GR1,DATA", "GR1 <- (DATA)"),
        ("LD GR1,GR2", "GR1 <- GR2"),
        ("LD GR1,=1234", "GR1 <- (=1234)"),
        ("ADDA GR1,DATA,GR2", "GR1 <- GR1 + (DATA + GR2)"),
        ("ADDL GR1,GR2", "GR1 <- GR1 + GR2"),
        ("SUBA GR1,GR2", "GR1 <- GR1 - GR2"),
        ("SUBL GR1,DATA", "GR1 <- GR1 - (DATA)"),
        ("AND GR1,DATA,GR2", "GR1 <- GR1 AND (DATA + GR2)"),
        ("OR GR1,GR2", "GR1 <- GR1 OR GR2"),
        ("XOR GR1,DATA", "GR1 <- GR1 XOR (DATA)"),
        ("ST GR1,DATA", "<DATA> <- GR1"),
        ("ST GR5,0,GR7", "<0+GR7> <- GR5"),
        ("SRA GR1,2,GR2", "GR1 <- GR1 >> 2 + GR2"),
        ("SRL GR1,2", "GR1 <- GR1 >> 2"),
        ("SLA GR1,2", "GR1 <- GR1 << 2"),
        ("SLL GR1,DATA,GR3", "GR1 <- GR1 << DATA + GR3"),
        ("CPA GR1,GR2", "GR1 : GR2"),
        ("CPL GR1,DATA,GR2", "GR1 : (DATA + GR2)"),
        ("JUMP LOOP", "goto LOOP"),
        ("CALL MUL", "goto MUL"),
        ("JPL LOOP", "SF=0 & ZF=0 then goto LOOP"),
        ("JMI LOOP", "SF=1 then goto LOOP"),
        ("JNZ LOOP", "ZF=0 then goto LOOP"),
        ("JZE LOOP", "ZF=1 then goto LOOP"),
        ("JOV LOOP", "OF=1 then goto LOOP"),
        ("JUMP 0,GR7", "goto 0 + GR7"),
        ("PUSH 0,GR1", "SP <- SP - 1, <SP> <- 0 + GR1"),
        ("POP GR1", "(SP) -> GR1, SP <- SP + 1"),
    ] {
        assert_eq!(
            comment_for(instruction),
            format!(" {instruction}\t;{expected}")
        );
    }
}

#[test]
fn nop_never_generates_or_replaces_a_comment() {
    let source = "MAIN START\n NOP\nKEEP NOP ;hand-written\nOLD NOP\t;no operation\n RET\n END\n";
    assert!(assemble(source, 32).is_ok());
    for overwrite in [false, true] {
        assert!(auto_comments(&[(None, source)], None, 32, overwrite).is_empty());
    }
}

#[test]
fn data_directives_keep_constant_spelling_and_use_addresses_for_unnamed_data() {
    let source = "MAIN START\nDATA DC 1234\nARR DC 1,2,3\nTEXT DC 'a,b''c',-1,#FFFF\nBUF DS 10\n DC 7\n DS 2\n RET\n END\n";
    let edits = auto_comments(&[(None, source)], None, 32, false);
    let text = |line| edits.iter().find(|e| e.line == line).unwrap().text.as_str();
    assert_eq!(text(2), "DATA DC 1234\t;<DATA> <- 1234");
    assert_eq!(text(3), "ARR DC 1,2,3\t;<ARR> <- 1,2,3");
    assert_eq!(
        text(4),
        "TEXT DC 'a,b''c',-1,#FFFF\t;<TEXT> <- 'a,b''c',-1,#FFFF"
    );
    assert_eq!(text(5), "BUF DS 10\t;allocate 10 words for BUF");
    let image = assemble(source, 32).unwrap();
    for line in [6, 7] {
        let address = image.rows.iter().find(|r| r.line == line).unwrap().address;
        assert!(text(line).contains(&format!("#{address:04X}")));
    }
}

#[test]
fn overwrite_only_changes_supported_valid_lines_and_keeps_exclusions_verbatim() {
    let source = "MAIN START ;entry\r\n LAD GR1,DATA   ;hand-written\r\n RET ;return\r\n SVC 0 ;svc\r\n IN BUF,LEN ;input\r\n OUT BUF,LEN ;output\r\n RPUSH ;save\r\n RPOP ;restore\r\nDATA DC 1 ;data\r\nBUF DS 1 ;buffer\r\nLEN DC 1 ;length\r\n;comment only\r\n END ;end\r\n";
    assert!(assemble(source, 32).is_ok());
    assert!(auto_comments(&[(None, source)], None, 32, false).is_empty());
    let edits = auto_comments(&[(None, source)], None, 32, true);
    assert_eq!(
        edits.iter().map(|e| e.line).collect::<Vec<_>>(),
        vec![2, 9, 10, 11]
    );
    assert_eq!(edits[0].text, " LAD GR1,DATA\t;GR1 <- DATA");
}

#[test]
fn syntax_linker_scope_and_encoding_errors_are_all_skipped_in_one_pass() {
    let source = "MAIN START\n LD GR8,DATA ;bad register\n LD GR1,MISSING ;unresolved despite syntax errors\n ST GR1,DATA,GR0 ;bad index\n LD GR1,GR2,GR3 ;bad register form\n bad GR1,DATA ;unknown\n LD GR1,DATA ;keep\n LAD GR2,DATA\nDATA DC 1\nDATA DC 2 ;duplicate\nTEXT DC 'a;b' ;semicolon in string is invalid in WCASL2\n LAD GR3,DATA ;😀\n RET ;return\n END\n";
    let edits = auto_comments(&[(Some("main"), source)], Some("main"), 32, true);
    assert_eq!(
        edits.iter().map(|e| e.line).collect::<Vec<_>>(),
        vec![7, 8, 9]
    );
}

#[test]
fn external_names_use_project_context_but_local_names_do_not_leak_between_files() {
    let main = "MAIN START\n CALL SUB\n LD GR1,HIDDEN ;private\n LAD GR2,GR8 ;bad label reference\n RET\n END\n";
    let sub = "SUB START\nHIDDEN DC 1\n RET\n END\n";
    let edits = auto_comments(
        &[(Some("main"), main), (Some("sub"), sub)],
        Some("main"),
        32,
        true,
    );
    assert_eq!(edits.len(), 1);
    assert_eq!(edits[0].text, " CALL SUB\t;goto SUB");
}

#[test]
fn generated_comments_are_idempotent_preserve_the_image_and_respect_byte_limits() {
    let source = "MAIN START\n LAD GR1,DATA\n LD GR2,=7\nDATA DC 1,2\n RET\n END\n";
    let original = assemble(source, 32).unwrap();
    let edits = auto_comments(&[(None, source)], None, 32, false);
    let mut lines: Vec<_> = source.split('\n').map(str::to_owned).collect();
    for edit in edits {
        lines[edit.line - 1] = edit.text;
    }
    let commented = lines.join("\n");
    assert_eq!(original.words, assemble(&commented, 32).unwrap().words);
    assert!(auto_comments(&[(None, &commented)], None, 32, false).is_empty());
    assert!(auto_comments(&[(None, &commented)], None, 32, true).is_empty());
    let long = format!("MAIN START\nDATA DC '{}'\n RET\n END\n", "漢".repeat(50));
    assert!(assemble(&long, 32).is_ok());
    assert!(auto_comments(&[(None, &long)], None, 32, true).is_empty());
}

#[test]
fn global_placement_errors_and_missing_end_never_annotate_invalid_references() {
    let source = "MAIN START\n LAD GR1,DATA\nDATA DS 2980\n END\n";
    assert!(auto_comments(&[(None, source)], None, 32, true).is_empty());
    let partial = "MAIN START\n LD GR1,UNKNOWN\n LAD GR2,0\n RET\n";
    let edits = auto_comments(&[(None, partial)], None, 32, true);
    assert_eq!(edits.len(), 1);
    assert_eq!(edits[0].line, 3);
}
