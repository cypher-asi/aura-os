#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnFamilyName {
    Settings,
}

impl ColumnFamilyName {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Settings => "settings",
        }
    }
}

pub enum BatchOp {
    Put {
        cf: String,
        key: String,
        value: Vec<u8>,
    },
    Delete {
        cf: String,
        key: String,
    },
}
