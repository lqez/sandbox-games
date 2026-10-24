extends Node
## 개발용: 빈 장면의 처리 시간(perf.gd 숫자를 읽는 기준점)
var t := 0.0
var s := 0.0
var n := 0
func _process(delta: float) -> void:
	t += delta
	if t > 2.0:
		s += Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0
		n += 1
	if t > 6.0:
		print("empty cpu ms: process avg %.2f fps %.0f" % [s / n, Engine.get_frames_per_second()])
		get_tree().quit()
