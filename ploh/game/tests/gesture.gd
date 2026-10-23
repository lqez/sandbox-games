extends Node
## 개발용: 터치 이벤트를 직접 넣어 탭과 플릭을 가리는지 확인한다
const Game := preload("res://main.tscn")
var boot: Node
var t := 0.0
var step := 0
var log: Array = []
func _ready() -> void:
	boot = Game.instantiate()
	add_child(boot)
func _touch(pressed: bool, pos: Vector2) -> void:
	var e := InputEventScreenTouch.new()
	e.index = 0
	e.pressed = pressed
	e.position = pos
	boot.game.hud._input(e)
func _drag(pos: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = 0
	e.position = pos
	boot.game.hud._input(e)
func _process(delta: float) -> void:
	t += delta
	var g = boot.game
	if g == null or g.player == null:
		return
	var p = g.player
	match step:
		0:
			if t > 3.5:
				log.append("before tap: state=%s" % p.state)
				_touch(true, Vector2(360, 700))
				step = 1
		1:
			if t > 3.62:
				log.append("tap held 120ms: state=%s" % p.state)
				_touch(false, Vector2(360, 700))
				step = 2
		2:
			if t > 5.0:
				log.append("before flick: state=%s" % p.state)
				_touch(true, Vector2(360, 700))
				step = 3
		3:
			if t > 5.03:
				_drag(Vector2(440, 700))
				step = 4
		4:
			if t > 5.06:
				_touch(false, Vector2(440, 700))
				log.append("after flick: state=%s move=%s" % [p.state, p.move_kind])
				step = 5
		5:
			if t > 5.3:
				log.append("flick+0.25s: state=%s" % p.state)
				print("\n".join(log))
				get_tree().quit()
