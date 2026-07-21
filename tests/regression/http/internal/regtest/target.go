package regtest

import "os"

type TargetMode string

const (
	ModeDev  TargetMode = "dev"
	ModeProd TargetMode = "prod"
)

func Mode() TargetMode {
	m := os.Getenv("REGRESSION_MODE")
	if m == "prod" {
		return ModeProd
	}
	return ModeDev
}

func BaseURL() string {
	return "http://127.0.0.1:4100"
}

func StartCommand() string {
	if Mode() == ModeProd {
		return "bun run regression:start:prod"
	}
	return "bun run regression:start:dev"
}
