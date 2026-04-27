use crate::state::AppState;

pub(super) fn router_url(state: &AppState) -> String {
    state.router_url.clone()
}
