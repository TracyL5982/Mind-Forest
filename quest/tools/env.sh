# Sourced by the other scripts: where the tools are and what the app is called.
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
QUEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$QUEST_ROOT/.." && pwd)"
# QUEST_APP_SUFFIX=.agents works on the second copy that run.sh installs beside the first.
APP_ID=com.kaifengwu.mindpalace.ocean${QUEST_APP_SUFFIX:-}
APP_ACTIVITY=com.kaifengwu.mindpalace.MainActivity
DEVICE_FILES=/sdcard/Android/data/$APP_ID/files
