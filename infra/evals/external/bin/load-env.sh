# POSIX helper sourced by external benchmark runners.
# Loads repo .env files plus local-stack runtime env files if they exist.
#
# Important: parse dotenv-style KEY=VALUE lines instead of sourcing the files.
# The repo .env can contain values that are valid dotenv but not valid shell.

external_bench__trim() {
    # Trim leading/trailing spaces and tabs.
    printf '%s' "$1" | sed 's/^[	 ]*//; s/[	 ]*$//'
}

external_bench__load_env_file() {
    env_file="$1"
    [ -f "$env_file" ] || return 0

    while IFS= read -r raw_line || [ -n "$raw_line" ]; do
        line=$(external_bench__trim "$raw_line")
        case "$line" in
            ""|\#*) continue ;;
            export\ *) line=$(external_bench__trim "${line#export }") ;;
        esac

        case "$line" in
            *=*) ;;
            *) continue ;;
        esac

        key=$(external_bench__trim "${line%%=*}")
        value=$(external_bench__trim "${line#*=}")

        case "$key" in
            ""|[!A-Za-z_]*|*[!A-Za-z0-9_]*)
                continue
                ;;
        esac

        case "$value" in
            \"*\")
                value=${value#\"}
                value=${value%\"}
                ;;
            \'*\')
                value=${value#\'}
                value=${value%\'}
                ;;
        esac

        # Benchmark auth should follow the repo .env/local-stack files, even
        # if the parent shell still has an older token exported.
        case "$key" in
            AURA_EVAL_ACCESS_TOKEN|AURA_ACCESS_TOKEN|AURA_NETWORK_AUTH_TOKEN)
                eval "$key=\$(printf '%s' \"\$value\")"
                export "$key"
                continue
                ;;
        esac

        # Do not override other explicitly exported process env.
        eval "existing=\${$key+x}"
        if [ -z "$existing" ]; then
            eval "$key=\$(printf '%s' \"\$value\")"
            export "$key"
        fi
    done < "$env_file"
}

external_bench_load_env() {
    repo_root="$1"
    local_stack_dir="$repo_root/infra/evals/local-stack"
    runtime_dir="${AURA_STACK_RUNTIME_DIR:-$local_stack_dir/.runtime}"

    for env_file in \
        "$repo_root/.env" \
        "$repo_root/.env.local" \
        "$local_stack_dir/stack.env" \
        "$runtime_dir/evals.env" \
        "$runtime_dir/auth.env"
    do
        external_bench__load_env_file "$env_file"
    done

    if [ -z "${AURA_EVAL_ACCESS_TOKEN:-}" ]; then
        if [ -n "${AURA_ACCESS_TOKEN:-}" ]; then
            AURA_EVAL_ACCESS_TOKEN="$AURA_ACCESS_TOKEN"
            export AURA_EVAL_ACCESS_TOKEN
        elif [ -n "${AURA_NETWORK_AUTH_TOKEN:-}" ]; then
            AURA_EVAL_ACCESS_TOKEN="$AURA_NETWORK_AUTH_TOKEN"
            export AURA_EVAL_ACCESS_TOKEN
        elif [ -n "${AURA_STACK_AURA_OS_DATA_DIR:-}" ] && command -v cargo >/dev/null 2>&1; then
            if token=$(cargo run -q -p aura-os-server --bin print-auth-token -- "$AURA_STACK_AURA_OS_DATA_DIR" 2>/dev/null); then
                if [ -n "$token" ]; then
                    AURA_EVAL_ACCESS_TOKEN="$token"
                    export AURA_EVAL_ACCESS_TOKEN
                fi
            fi
        fi
    fi

    if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -n "${AURA_STACK_ANTHROPIC_API_KEY:-}" ]; then
        ANTHROPIC_API_KEY="$AURA_STACK_ANTHROPIC_API_KEY"
        export ANTHROPIC_API_KEY
    fi

    if [ -z "${AURA_EVAL_API_BASE_URL:-}" ] && [ -n "${AURA_STACK_AURA_OS_PORT:-}" ]; then
        AURA_EVAL_API_BASE_URL="http://127.0.0.1:${AURA_STACK_AURA_OS_PORT}"
        export AURA_EVAL_API_BASE_URL
    fi
}
