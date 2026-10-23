extends Node
## 시작점. 3D를 SubViewport에서 화면보다 낮은 해상도로 그려 늘리고, UI는 원래 해상도로 그린다.
##
## 저사양 아이폰에서 60fps를 지키기 위한 장치다.
## - 3D 해상도: 실제 화면 픽셀 × quality. 프레임 시간을 재서 자동으로 조절한다(동적 해상도)
## - 모바일: 실시간 그림자·글로우를 끄고, 물웅덩이의 화면 복사 반사를 가벼운 버전으로 바꾸고, 먼 횃불 조명을 끈다
## 주소 끝에 ?q=high / ?q=low 를 붙이면 품질을 고정할 수 있고, ?fps 를 붙이면 프레임 수를 보여 준다.

const Game := preload("res://scenes/game.tscn")

const TARGET_MS := 1000.0 / 60.0
const MIN_SCALE := 0.4
const STEP := 0.05

var view: SubViewport
var rect: TextureRect
var game: Node
var mobile := false
var scale := 1.0              # 실제 화면 픽셀 대비 3D 해상도
var max_scale := 1.0
var adaptive := true
var show_fps := false
var _acc := 0.0
var _frames := 0
var _probing := false
var _fast := 0
var fps := 0.0


func _ready() -> void:
	_detect()
	view = SubViewport.new()
	view.msaa_3d = Viewport.MSAA_DISABLED
	view.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	view.positional_shadow_atlas_size = 0
	add_child(view)
	rect = TextureRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_SCALE
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.texture = view.get_texture()
	add_child(rect)
	game = Game.instantiate()
	game.mobile = mobile
	game.boot = self
	view.add_child(game)
	get_tree().root.size_changed.connect(_resize)
	_resize()


func _detect() -> void:
	var query := ""
	if OS.has_feature("web"):
		var ua: String = str(JavaScriptBridge.eval("navigator.userAgent", true))
		query = str(JavaScriptBridge.eval("location.search", true))
		mobile = ua.contains("iPhone") or ua.contains("iPad") or ua.contains("Android") or ua.contains("Mobile")
	else:
		# 개발용: 데스크톱에서 -- --mobile 로 휴대폰 설정을 흉내 낸다
		mobile = OS.has_feature("mobile") or "--mobile" in OS.get_cmdline_user_args()
	# 휴대폰은 실제 픽셀이 화면 크기의 2~3배라 처음부터 낮춰 시작한다
	max_scale = 0.7 if mobile else 1.0
	scale = 0.55 if mobile else 1.0
	if query.contains("q=high"):
		scale = 1.0
		max_scale = 1.0
		adaptive = false
	elif query.contains("q=low"):
		scale = 0.45
		max_scale = 0.45
		adaptive = false
	show_fps = query.contains("fps")


func _resize() -> void:
	var px := Vector2(DisplayServer.window_get_size())
	view.size = Vector2i(maxi(int(px.x * scale), 64), maxi(int(px.y * scale), 64))


## HUD 좌표(루트 캔버스) ↔ 3D 화면 좌표(SubViewport) 비율
func view_to_hud() -> Vector2:
	var hud_size := get_viewport().get_visible_rect().size
	return hud_size / Vector2(view.size)


func _process(delta: float) -> void:
	_acc += delta
	_frames += 1
	if _acc < 0.5:
		return
	var ms := _acc * 1000.0 / _frames
	fps = _frames / _acc
	_acc = 0.0
	_frames = 0
	if not adaptive:
		return
	# 브라우저는 수직 동기화로 60fps에 묶여 있어 "더 빠름"을 잴 수 없다.
	# 그래서 목표를 놓치면 바로 낮추고, 3초 동안 목표를 지키면 한 단계 올려 본다.
	# 올려 본 직후 다시 느려지면 그 아래를 상한으로 고정해 오르내림을 멈춘다.
	if ms > TARGET_MS * 1.1:
		_fast = 0
		if scale > MIN_SCALE:
			if _probing:
				max_scale = maxf(scale - STEP, MIN_SCALE)
			scale = maxf(scale - STEP * (2.0 if ms > TARGET_MS * 1.4 else 1.0), MIN_SCALE)
			_resize()
		_probing = false
	elif ms <= TARGET_MS * 1.04:
		_fast += 1
		if _fast >= 6 and scale < max_scale:
			_fast = 0
			scale = minf(scale + STEP, max_scale)
			_probing = true
			_resize()
