//! ANSI MFC CArchive used by WCASL2's .cmk documents.
use crate::{decode_source, encode_cp932};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectFile {
    pub path: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub stored_path: String,
    pub main_path: String,
    pub files: Vec<ProjectFile>,
}

impl Project {
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let mut reader = Reader { bytes, pos: 0 };
        let count = u32::from_le_bytes(reader.take(4)?.try_into().unwrap()) as usize;
        if count > 20 {
            return Err("cmkの登録数が範囲外です（0〜20）。".into());
        }
        let mut project = Self {
            stored_path: reader.string()?,
            main_path: reader.string()?,
            files: Vec::with_capacity(count),
        };
        for _ in 0..count {
            project.files.push(ProjectFile {
                path: reader.string()?,
                name: reader.string()?,
            });
        }
        if reader.pos != bytes.len() {
            return Err("cmkの末尾に未対応のデータがあります。".into());
        }
        Ok(project)
    }

    pub fn encode(&self) -> Result<Vec<u8>, String> {
        if self.files.len() > 20 {
            return Err("cmkには20ファイルまで登録できます。".into());
        }
        let mut bytes = (self.files.len() as u32).to_le_bytes().to_vec();
        for text in [&self.stored_path, &self.main_path]
            .into_iter()
            .chain(self.files.iter().flat_map(|file| [&file.path, &file.name]))
        {
            if text.contains('\0') {
                return Err("cmkの文字列にNULは使用できません。".into());
            }
            let encoded = encode_cp932(text)?;
            let len = encoded.len();
            if len < 255 {
                bytes.push(len as u8);
            } else {
                bytes.push(255);
                if len < 65534 {
                    bytes.extend((len as u16).to_le_bytes());
                } else {
                    bytes.extend(u16::MAX.to_le_bytes());
                    bytes.extend(
                        u32::try_from(len)
                            .map_err(|_| "cmkの文字列が長すぎます。")?
                            .to_le_bytes(),
                    );
                }
            }
            bytes.extend(encoded);
        }
        Ok(bytes)
    }

    /// The actual opened archive, never stored_path, determines the base directory.
    pub fn resolved_paths(&self, archive: &Path) -> Result<Vec<PathBuf>, String> {
        if !archive.is_absolute() {
            return Err("cmkの実際の絶対パスを指定してください。".into());
        }
        let parent = archive
            .parent()
            .ok_or("cmkのフォルダーを取得できません。")?;
        self.files
            .iter()
            .map(|file| {
                if file.path.is_empty() || file.path.contains('\0') {
                    return Err("cmkのソースパスが空または不正です。".into());
                }
                let path = Path::new(&file.path);
                if !path.is_absolute()
                    && (path.has_root()
                        || matches!(
                            path.components().next(),
                            Some(std::path::Component::Prefix(_))
                        ))
                {
                    return Err("ドライブ相対・ルート相対のソースパスには対応していません。".into());
                }
                Ok(if path.is_absolute() {
                    path.to_owned()
                } else {
                    parent.join(path)
                })
            })
            .collect()
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self
            .pos
            .checked_add(count)
            .filter(|end| *end <= self.bytes.len())
            .ok_or("cmkのデータが途中で切れています。")?;
        let value = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(value)
    }
    fn string(&mut self) -> Result<String, String> {
        let mut len = self.take(1)?[0] as usize;
        if len == 255 {
            len = u16::from_le_bytes(self.take(2)?.try_into().unwrap()) as usize;
            if len == 65534 {
                return Err("Unicode版のMFCアーカイブには対応していません。".into());
            }
            if len == 65535 {
                len = u32::from_le_bytes(self.take(4)?.try_into().unwrap()) as usize;
            }
        }
        let text = decode_source(self.take(len)?)?;
        if text.contains('\0') {
            return Err("cmkにNULを含む文字列があります。".into());
        }
        Ok(text)
    }
}
