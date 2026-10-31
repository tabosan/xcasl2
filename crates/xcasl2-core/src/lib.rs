//! WCASL2 compatibility core. No desktop or web dependencies.
pub mod assembler;
pub mod devices;
pub mod machine;
pub mod pipeline;
pub mod project;
pub mod session;
pub mod settings;

pub use assembler::{assemble, assemble_sources, Diagnostic, Image, SourceRow};
pub use devices::{DeviceConfig, DeviceSnapshot};
pub use machine::{Cpu, Machine, Status, MEMORY_WORDS};
pub use pipeline::StepMode;
pub use session::{Session, Snapshot};

pub fn encode_cp932(text: &str) -> Result<Vec<u8>, String> {
    let (bytes, _, invalid) = encoding_rs::SHIFT_JIS.encode(text);
    if invalid {
        Err("CP932で表せない文字が含まれています。".into())
    } else {
        Ok(bytes.into_owned())
    }
}

pub fn decode_cp932(bytes: &[u8]) -> String {
    encoding_rs::SHIFT_JIS
        .decode_without_bom_handling(bytes)
        .0
        .into_owned()
}

pub fn decode_source(bytes: &[u8]) -> Result<String, String> {
    let (text, invalid) = encoding_rs::SHIFT_JIS.decode_without_bom_handling(bytes);
    if invalid {
        Err("CP932として読み取れないバイトが含まれています。".into())
    } else {
        Ok(text.into_owned())
    }
}
