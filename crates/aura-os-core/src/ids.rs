use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

macro_rules! define_id {
    ($name:ident) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            pub fn nil() -> Self {
                Self(Uuid::nil())
            }

            pub fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            pub fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", stringify!($name), self.0)
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Ok(Self(s.parse()?))
            }
        }

        impl Default for $name {
            /// Returns the nil (all-zero) UUID sentinel. Use `new()` for a
            /// random ID. Returning nil avoids surprises when Default is used
            /// in struct initializers or `Option::unwrap_or_default`.
            fn default() -> Self {
                Self::nil()
            }
        }
    };
}

define_id!(ProjectId);
define_id!(SpecId);
define_id!(TaskId);
define_id!(AgentId);
define_id!(AgentInstanceId);
define_id!(SessionId);
define_id!(SessionEventId);
define_id!(OrgId);
define_id!(UserId);
define_id!(ProfileId);
define_id!(CronJobId);
define_id!(CronJobRunId);
define_id!(ArtifactId);
