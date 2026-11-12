package main

import (
	"9router/proxy/internal/tokensaver"
	"bufio"
	"encoding/json"
	"os"
)

func main() {
	s := bufio.NewScanner(os.Stdin)
	s.Buffer(make([]byte, 4096), 16*1024*1024)
	e := json.NewEncoder(os.Stdout)
	for s.Scan() {
		var r struct {
			Name    string          `json:"name"`
			Text    string          `json:"text"`
			Command string          `json:"command"`
			Config  json.RawMessage `json:"config"`
		}
		if err := json.Unmarshal(s.Bytes(), &r); err != nil {
			os.Exit(1)
		}
		cfg := tokensaver.DefaultRTKConfig()
		if len(r.Config) > 0 {
			if err := json.Unmarshal(r.Config, &cfg); err != nil {
				os.Exit(1)
			}
		}
		e.Encode(map[string]any{"name": r.Name, "text": r.Text, "command": r.Command, "config": json.RawMessage(r.Config), "expected": tokensaver.CompressTextDetailedWithCommand(r.Text, r.Command, cfg)})
	}
}
