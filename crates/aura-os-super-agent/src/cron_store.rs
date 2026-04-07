use std::sync::Arc;

use aura_os_core::{
    Artifact, ArtifactId, ArtifactType, CronJob, CronJobId, CronJobRun, CronJobRunId, CronTag,
    OrgId,
};
use aura_os_store::RocksStore;

const CF_CRON_JOBS: &str = "cron_jobs";
const CF_CRON_JOB_RUNS: &str = "cron_job_runs";
const CF_CRON_ARTIFACTS: &str = "cron_artifacts";
const CF_CRON_TAGS: &str = "cron_tags";

pub struct CronStore {
    store: Arc<RocksStore>,
}

impl CronStore {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    // -----------------------------------------------------------------------
    // Jobs
    // -----------------------------------------------------------------------

    pub fn save_job(&self, job: &CronJob) -> Result<(), String> {
        let key = job.cron_job_id.to_string();
        let value = serde_json::to_vec(job).map_err(|e| e.to_string())?;
        self.store
            .put_cf_bytes(CF_CRON_JOBS, key.as_bytes(), &value)
            .map_err(|e| e.to_string())
    }

    pub fn get_job(&self, id: &CronJobId) -> Result<Option<CronJob>, String> {
        let key = id.to_string();
        match self.store.get_cf_bytes(CF_CRON_JOBS, key.as_bytes()) {
            Ok(Some(bytes)) => {
                let job = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                Ok(Some(job))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn list_jobs(&self) -> Result<Vec<CronJob>, String> {
        let mut results: Vec<CronJob> = self
            .store
            .scan_cf_all(CF_CRON_JOBS)
            .map_err(|e| e.to_string())?;
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(results)
    }

    pub fn delete_job(&self, id: &CronJobId) -> Result<(), String> {
        self.store
            .write_batch(vec![aura_os_store::BatchOp::Delete {
                cf: CF_CRON_JOBS.to_string(),
                key: id.to_string(),
            }])
            .map_err(|e| e.to_string())
    }

    // -----------------------------------------------------------------------
    // Runs
    // -----------------------------------------------------------------------

    pub fn save_run(&self, run: &CronJobRun) -> Result<(), String> {
        let key = format!("{}:{}", run.cron_job_id, run.run_id);
        let value = serde_json::to_vec(run).map_err(|e| e.to_string())?;
        self.store
            .put_cf_bytes(CF_CRON_JOB_RUNS, key.as_bytes(), &value)
            .map_err(|e| e.to_string())
    }

    pub fn get_run(
        &self,
        job_id: &CronJobId,
        run_id: &CronJobRunId,
    ) -> Result<Option<CronJobRun>, String> {
        let key = format!("{job_id}:{run_id}");
        match self.store.get_cf_bytes(CF_CRON_JOB_RUNS, key.as_bytes()) {
            Ok(Some(bytes)) => {
                let run = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                Ok(Some(run))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn list_runs_for_job(&self, job_id: &CronJobId) -> Result<Vec<CronJobRun>, String> {
        let prefix = job_id.to_string();
        let all: Vec<CronJobRun> = self
            .store
            .scan_cf_all(CF_CRON_JOB_RUNS)
            .map_err(|e| e.to_string())?;
        let mut filtered: Vec<CronJobRun> = all
            .into_iter()
            .filter(|r| r.cron_job_id.to_string() == prefix)
            .collect();
        filtered.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(filtered)
    }

    // -----------------------------------------------------------------------
    // Artifacts
    // -----------------------------------------------------------------------

    pub fn save_artifact(&self, artifact: &Artifact) -> Result<(), String> {
        let key = format!("{}:{}", artifact.cron_job_id, artifact.artifact_id);
        let value = serde_json::to_vec(artifact).map_err(|e| e.to_string())?;
        self.store
            .put_cf_bytes(CF_CRON_ARTIFACTS, key.as_bytes(), &value)
            .map_err(|e| e.to_string())
    }

    pub fn get_artifact(&self, id: &ArtifactId) -> Result<Option<Artifact>, String> {
        let target = id.to_string();
        let all: Vec<Artifact> = self
            .store
            .scan_cf_all(CF_CRON_ARTIFACTS)
            .map_err(|e| e.to_string())?;
        Ok(all
            .into_iter()
            .find(|a| a.artifact_id.to_string() == target))
    }

    pub fn list_artifacts_for_job(&self, job_id: &CronJobId) -> Result<Vec<Artifact>, String> {
        let prefix = job_id.to_string();
        let all: Vec<Artifact> = self
            .store
            .scan_cf_all(CF_CRON_ARTIFACTS)
            .map_err(|e| e.to_string())?;
        let mut filtered: Vec<Artifact> = all
            .into_iter()
            .filter(|a| a.cron_job_id.to_string() == prefix)
            .collect();
        filtered.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(filtered)
    }

    pub fn get_latest_artifact(
        &self,
        job_id: &CronJobId,
        artifact_type: Option<ArtifactType>,
    ) -> Result<Option<Artifact>, String> {
        let mut artifacts = self.list_artifacts_for_job(job_id)?;
        if let Some(at) = artifact_type {
            artifacts.retain(|a| a.artifact_type == at);
        }
        Ok(artifacts.into_iter().next())
    }

    // -----------------------------------------------------------------------
    // Tags (org-scoped)
    // -----------------------------------------------------------------------

    pub fn save_tag(&self, tag: &CronTag) -> Result<(), String> {
        let key = format!("{}:{}", tag.org_id, tag.tag_id);
        let value = serde_json::to_vec(tag).map_err(|e| e.to_string())?;
        self.store
            .put_cf_bytes(CF_CRON_TAGS, key.as_bytes(), &value)
            .map_err(|e| e.to_string())
    }

    pub fn list_tags_for_org(&self, org_id: &OrgId) -> Result<Vec<CronTag>, String> {
        let prefix = org_id.to_string();
        let all: Vec<CronTag> = self
            .store
            .scan_cf_all(CF_CRON_TAGS)
            .map_err(|e| e.to_string())?;
        let mut filtered: Vec<CronTag> = all
            .into_iter()
            .filter(|t| t.org_id.to_string() == prefix)
            .collect();
        filtered.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(filtered)
    }

    pub fn delete_tag(&self, org_id: &OrgId, tag_id: &str) -> Result<(), String> {
        let key = format!("{org_id}:{tag_id}");
        self.store
            .write_batch(vec![aura_os_store::BatchOp::Delete {
                cf: CF_CRON_TAGS.to_string(),
                key,
            }])
            .map_err(|e| e.to_string())
    }
}
