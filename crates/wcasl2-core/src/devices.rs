//! WCASL2 file devices. Windows text conversion is explicit on every platform.
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::{self, BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceConfig {
    pub input_path: Option<PathBuf>,
    pub output_path: Option<PathBuf>,
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    if same_file::is_same_file(a, b).unwrap_or(false) {
        return true;
    }
    let absolute = |path: &Path| {
        path.canonicalize().unwrap_or_else(|_| {
            if path.is_absolute() {
                path.to_owned()
            } else {
                std::env::current_dir().unwrap_or_default().join(path)
            }
        })
    };
    let a = absolute(a);
    let b = absolute(b);
    if cfg!(windows) {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    } else {
        a == b
    }
}

impl DeviceConfig {
    pub fn absolute(self) -> Result<Self, String> {
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        let resolve = |path: PathBuf| {
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        };
        Ok(Self {
            input_path: self.input_path.map(resolve),
            output_path: self.output_path.map(resolve),
        })
    }

    pub fn validate(&self) -> Result<(), String> {
        for path in [&self.input_path, &self.output_path].into_iter().flatten() {
            if path.as_os_str().is_empty() || path.is_dir() {
                return Err("入出力にはファイルのパスを指定してください。".into());
            }
        }
        if let (Some(input), Some(output)) = (&self.input_path, &self.output_path) {
            if same_path(input, output) {
                return Err("入力元と出力先に同じファイルは指定できません。".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct DeviceSnapshot {
    pub config: DeviceConfig,
    pub input_open: bool,
    pub input_eof: bool,
    pub output_open: bool,
    pub output_started: bool,
    pub records_read: u64,
    pub records_written: u64,
    pub output_bytes: u64,
    pub buffered_bytes: usize,
}

/// ReadString's CString endpoint: NUL termination, TrimRight, then a 256-byte cut.
pub fn file_input_record(endpoint: Option<&[u8]>) -> Option<Vec<u8>> {
    endpoint.map(|bytes| {
        let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
        let bytes = &bytes[..end];
        let end = bytes
            .iter()
            .rposition(|b| !b.is_ascii_whitespace())
            .map_or(0, |i| i + 1);
        bytes[..end.min(256)].to_vec()
    })
}

/// CString/fputs truncates at NUL, including the appended LF. Text mode expands LF.
pub fn file_output_record(words: &[u8]) -> Vec<u8> {
    let nul = words.iter().position(|byte| *byte == 0);
    let prefix = &words[..nul.unwrap_or(words.len())];
    let mut result = Vec::with_capacity(prefix.len() + 2);
    for byte in prefix {
        if *byte == b'\n' {
            result.push(b'\r');
        }
        result.push(*byte);
    }
    if nul.is_none() {
        result.extend_from_slice(b"\r\n");
    }
    result
}

struct TextInput {
    reader: BufReader<File>,
    eof: bool,
}

impl TextInput {
    fn read_record(&mut self) -> io::Result<Option<Vec<u8>>> {
        if self.eof {
            return Ok(None);
        }
        let mut prefix = Vec::with_capacity(256);
        let mut position = 0usize;
        let mut last_nonwhite = 0usize;
        let mut nul = false;
        let mut any = false;
        // Consume the whole record but keep bounded memory, even for very long lines.
        loop {
            let mut byte = [0];
            if self.reader.read(&mut byte)? == 0 {
                self.eof = true;
                break;
            }
            let byte = byte[0];
            if byte == 0x1a {
                self.eof = true;
                break;
            }
            any = true;
            if byte == b'\n' {
                break;
            }
            if byte == 0 {
                nul = true;
            }
            if !nul {
                position += 1;
                if prefix.len() < 256 {
                    prefix.push(byte);
                }
                if !byte.is_ascii_whitespace() {
                    last_nonwhite = position;
                }
            }
        }
        if !any {
            return Ok(None);
        }
        prefix.truncate(last_nonwhite.min(256));
        Ok(Some(prefix))
    }
}

pub struct FileDevices {
    config: DeviceConfig,
    input: Option<TextInput>,
    input_eof: bool,
    output: Option<BufWriter<File>>,
    output_started: bool,
    records_read: u64,
    records_written: u64,
    output_bytes: u64,
}

impl Default for FileDevices {
    fn default() -> Self {
        Self::new(DeviceConfig::default())
    }
}

impl FileDevices {
    pub fn new(config: DeviceConfig) -> Self {
        Self {
            config,
            input: None,
            input_eof: false,
            output: None,
            output_started: false,
            records_read: 0,
            records_written: 0,
            output_bytes: 0,
        }
    }

    pub fn config(&self) -> &DeviceConfig {
        &self.config
    }

    pub fn snapshot(&self) -> DeviceSnapshot {
        DeviceSnapshot {
            config: self.config.clone(),
            input_open: self.input.is_some(),
            input_eof: self.input_eof,
            output_open: self.output.is_some(),
            output_started: self.output_started,
            records_read: self.records_read,
            records_written: self.records_written,
            output_bytes: self.output_bytes,
            buffered_bytes: self
                .output
                .as_ref()
                .map_or(0, |writer| writer.buffer().len()),
        }
    }

    pub fn read_record(&mut self) -> Result<Option<Vec<u8>>, String> {
        let path = self
            .config
            .input_path
            .as_ref()
            .ok_or("入力ファイルが未指定です。")?;
        if self.input.is_none() {
            let mut options = OpenOptions::new();
            options.read(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(1); // Other readers may inspect input; deny writers while open.
            }
            let file = options
                .open(path)
                .map_err(|e| format!("入力ファイルを開けません: {} ({e})", path.display()))?;
            self.input = Some(TextInput {
                reader: BufReader::new(file),
                eof: false,
            });
        }
        let record = self
            .input
            .as_mut()
            .expect("input is open")
            .read_record()
            .map_err(|e| format!("入力ファイルを読めません: {} ({e})", path.display()))?;
        self.input_eof = self.input.as_ref().is_some_and(|input| input.eof);
        if record.is_some() {
            self.records_read += 1;
        }
        Ok(record)
    }

    pub fn write_record(&mut self, words: &[u8]) -> Result<(), String> {
        if words.is_empty() {
            return Ok(());
        } // Native length-zero OUT never opens the file.
        let path = self
            .config
            .output_path
            .as_ref()
            .ok_or("出力ファイルが未指定です。")?;
        if self.output.is_none() {
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(0); // Matches the observed denial of external reads/writes.
            }
            let file = options
                .open(path)
                .map_err(|e| format!("出力ファイルを開けません: {} ({e})", path.display()))?;
            self.output = Some(BufWriter::with_capacity(4096, file));
            self.output_started = true;
        }
        let bytes = file_output_record(words);
        self.output
            .as_mut()
            .expect("output is open")
            .write_all(&bytes)
            .map_err(|e| format!("出力ファイルへ書けません: {} ({e})", path.display()))?;
        self.records_written += 1;
        self.output_bytes += bytes.len() as u64;
        Ok(())
    }

    pub fn close(&mut self) -> Result<(), String> {
        self.input = None;
        if let Some(mut writer) = self.output.take() {
            if let Err(error) = writer.flush() {
                self.output = Some(writer); // Keep bytes available for a later close retry.
                return Err(format!("出力ファイルを確定できません: {error}"));
            }
        }
        Ok(())
    }

    pub fn rewind(&mut self) -> Result<(), String> {
        self.close()?;
        *self = Self::new(self.config.clone());
        Ok(())
    }
}
