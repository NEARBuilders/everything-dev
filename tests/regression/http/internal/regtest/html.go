package regtest

import "strings"

func HTMLContainsTitle(html string) bool {
	return strings.Contains(html, "<title>") && strings.Contains(html, "</title>")
}

func HTMLContainsMetaName(html, name string) bool {
	// Support both orderings:
	//   <meta name="description" content="...">
	//   <meta content="..." name="description">
	return strings.Contains(html, `name="`+name+`"`) ||
		strings.Contains(html, `name='`+name+`'`)
}

func HTMLContainsMetaProperty(html, property string) bool {
	return strings.Contains(html, `property="`+property+`"`)
}

func HTMLContainsManifest(html string) bool {
	return strings.Contains(html, `<link rel="manifest"`) || strings.Contains(html, `<link rel='manifest'`)
}

func HTMLContainsRuntimeConfig(html string) bool {
	return strings.Contains(html, "window.__RUNTIME_CONFIG__")
}
