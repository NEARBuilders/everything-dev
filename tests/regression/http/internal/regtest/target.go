package regtest

import "os"

type TargetMode string

const (
	ModeDev        TargetMode = "dev"
	ModeStart      TargetMode = "start"
	ModeBackcompat TargetMode = "backcompat"
)

func Mode() TargetMode {
	switch os.Getenv("REGRESSION_MODE") {
	case "start", "start:ssr", "start:csr":
		return ModeStart
	case "backcompat":
		return ModeBackcompat
	}
	return ModeDev
}

// BaseURL comes from the repo-derived config (REGRESSION_BASE_URL or
// bos.config state), not a hardcoded upstream port.
func BaseURL() string {
	return LoadConfig().BaseURL
}

// Origin is the browser origin the target is configured with (CORS Origin).
func Origin() string {
	return BaseURL()
}

// ScriptName is the package.json script that boots the target for the mode.
func ScriptName() string {
	switch Mode() {
	case ModeStart:
		return "regression:start:ssr"
	case ModeBackcompat:
		return "regression:backcompat"
	}
	return "regression:dev:ssr"
}
