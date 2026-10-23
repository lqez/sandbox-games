extends Node
## 개발용: 게임을 띄워 정해진 시각에 탭하고 화면을 PNG로 저장한다.
## 실행: Godot --path ploh/game --resolution 430x932 res://tests/shot.tscn -- <출력 폴더>

const Game := preload("res://main.tscn")
var game: Node
var out := ""
var t := 0.0
var shots := [3.2, 3.35, 3.5, 4.2, 4.4, 5.0, 5.6, 6.2, 7.0, 8.0]
var taps := [2.9, 3.25, 3.6, 3.95, 4.3, 4.65, 5.0, 5.35, 5.7, 6.05, 6.4, 6.75, 7.1]
var n := 0


func _ready() -> void:
	out = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp"
	game = Game.instantiate()
	add_child(game)


func _process(delta: float) -> void:
	t += delta / maxf(Engine.time_scale, 0.05)
	while taps.size() > 0 and t >= taps[0]:
		taps.pop_front()
		game.tap_down()
		game.tap_up()
	if shots.size() > 0 and t >= shots[0]:
		shots.pop_front()
		get_viewport().get_texture().get_image().save_png("%s/shot_%02d.png" % [out, n])
		n += 1
	if shots.is_empty():
		get_tree().quit()
