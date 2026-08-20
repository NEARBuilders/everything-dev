package regtest

import "os"

type TargetMode string

const (
	ModeDev        TargetMode = "dev"
	ModeProd       TargetMode = "prod"
	ModeBackcompat TargetMode = "backcompat"
)

func Mode() TargetMode {
	switch os.Getenv("REGRESSION_MODE") {
	case "prod":
		return ModeProd
	case "backcompat":
		return ModeBackcompat
	}
	return ModeDev
}

func BaseURL() string {
	return "http://localhost:4100"
}

func StartCommand() string {
	switch Mode() {
	case ModeProd:
		return "bun run regression:start:prod"
	case ModeBackcompat:
		return "bun run regression:start:backcompat"
	}
	return "bun run regression:start:dev"
}
