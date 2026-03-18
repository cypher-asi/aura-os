#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnFamilyName {
    Projects,
    Specs,
    Tasks,
    Agents,
    Sessions,
    Settings,
    Orgs,
}

impl ColumnFamilyName {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Projects => "projects",
            Self::Specs => "specs",
            Self::Tasks => "tasks",
            Self::Agents => "agents",
            Self::Sessions => "sessions",
            Self::Settings => "settings",
            Self::Orgs => "orgs",
        }
    }
}

pub enum BatchOp {
    Put {
        cf: ColumnFamilyName,
        key: String,
        value: Vec<u8>,
    },
    Delete {
        cf: ColumnFamilyName,
        key: String,
    },
}
