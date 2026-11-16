# Sourced by the other scripts: where the tools are and what the app is called.
# JDK 17: Homebrew's where it is there, otherwise whichever 17 macOS knows of.
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
[ -d "$JAVA_HOME" ] || JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)"
export JAVA_HOME
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
QUEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$QUEST_ROOT/.." && pwd)"
# QUEST_APP_SUFFIX=.agents works on the second copy that run.sh installs beside the first.
APP_ID=com.kaifengwu.mindpalace.ocean${QUEST_APP_SUFFIX:-}
APP_ACTIVITY=com.kaifengwu.mindpalace.MainActivity
DEVICE_FILES=/sdcard/Android/data/$APP_ID/files
