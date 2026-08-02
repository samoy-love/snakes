package main

import "testing"

func TestMustCwdIsNeverEmpty(t *testing.T) {
	if got := mustCwd(); got == "" {
		t.Fatal("mustCwd вернул пустую строку — раздача статики уехала бы в корень ФС")
	}
}

// Version/Commit/BuildTime подставляет линкер (-X main.Version=...). Значения
// по умолчанию обязаны быть непустыми: пустой version уезжает клиенту в hello
// и ломает сверку версии на фронте, а пустой commit обесценивает лог сборки.
func TestBuildMetadataHasDefaults(t *testing.T) {
	if Version == "" || Commit == "" || BuildTime == "" {
		t.Fatal("Version/Commit/BuildTime должны иметь значения по умолчанию")
	}
}
