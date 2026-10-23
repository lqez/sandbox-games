extends Node2D
## 세로 전투 시제품의 전투 로직.
##
## 기본은 자동 전투이고, 플레이어는 궁극기 탭·연계·방어 타이밍으로 개입한다.
## 전장(field.gd)과 UI(hud.gd)는 이 노드의 상태를 읽어 그리기만 한다.

const Field := preload("res://scripts/field.gd")
const Hud := preload("res://scripts/hud.gd")

const CHAIN_WINDOW := 3.0        # 이 시간 안에 다음 궁극기를 쓰면 연계가 이어진다
const TELEGRAPH_TIME := 2.4      # 균열 폭발 예고 시간
const PERFECT_WINDOW := 0.45     # 폭발 직전 이 구간에 방어하면 완벽 방어
const GUARD_WINDOW := 1.3        # 이 구간에 방어하면 일반 방어
const BLAST_INTERVAL := 9.0
const BOSS_WEAKNESS := "water"

var heroes: Array = []
var boss: Dictionary
var minions: Array = []

var state := "battle"            # battle, win, lose
var auto_mode := true
var speed := 1
var elapsed := 0.0
var chain := 0
var chain_timer := 0.0
var last_ult_hero := -1
var blast_timer := BLAST_INTERVAL
var telegraph := -1.0            # 남은 예고 시간. 음수면 예고 없음
var telegraph_total := TELEGRAPH_TIME
var guard_window := GUARD_WINDOW
var perfect_window := PERFECT_WINDOW
var guard := ""                  # 이번 예고에 대한 방어 결과: "", "guard", "perfect", "early"
var auto_guard_at := 0.0
var perfect_count := 0
var phase_spawned := [false, false]
var log_lines: Array = []

var field: Node2D
var hud: Control


func _ready() -> void:
	randomize()
	field = Field.new()
	field.game = self
	add_child(field)
	var layer := CanvasLayer.new()
	add_child(layer)
	hud = Hud.new()
	hud.game = self
	layer.add_child(hud)
	get_viewport().size_changed.connect(_fit_orientation)
	_fit_orientation()
	reset()


## 화면 방향에 맞춰 기준 해상도를 바꾼다. 세로는 720×1280, 가로는 1280×720을 기준으로 늘린다.
func _fit_orientation() -> void:
	var win := get_window()
	var target := Vector2i(720, 1280) if win.size.y >= win.size.x else Vector2i(1280, 720)
	if win.content_scale_size != target:
		win.content_scale_size = target


func reset() -> void:
	heroes = [
		_unit("창기사", "fire", "striker", 1150, 95, 34, Color(0.92, 0.42, 0.28)),
		_unit("수호기사", "earth", "guardian", 1700, 62, 26, Color(0.55, 0.75, 0.38)),
		_unit("물의 무녀", "water", "priest", 1000, 78, 30, Color(0.35, 0.62, 0.95)),
	]
	heroes[0].rule = "보스 HP 30% 이하이거나 연계 중이면 궁극기"
	heroes[1].rule = "아군 HP 60% 이하이거나 폭발 예고 중이면 궁극기"
	heroes[2].rule = "연계 2단계 이상이거나 잡몹이 있으면 궁극기"
	boss = _unit("균열의 군주", "earth", "boss", 26000, 120, 22, Color(0.55, 0.12, 0.22))
	minions = [_minion(0), _minion(1)]
	state = "battle"
	elapsed = 0.0
	chain = 0
	chain_timer = 0.0
	last_ult_hero = -1
	blast_timer = BLAST_INTERVAL
	telegraph = -1.0
	guard = ""
	perfect_count = 0
	phase_spawned = [false, false]
	log_lines.clear()
	field.effects.clear()


func _unit(n: String, element: String, role: String, hp: int, atk: int, spd: int, color: Color) -> Dictionary:
	return {
		"name": n, "element": element, "role": role, "color": color,
		"max_hp": hp, "hp": float(hp), "atk": atk, "spd": spd,
		"gauge": randf() * 60.0, "ult": 30.0, "ult_held": 0.0,
		"shield": 0.0, "taunt": 0.0, "flash": 0.0, "lunge": 0.0, "rule": "", "rule_on": true,
	}


func _minion(slot: int) -> Dictionary:
	var m := _unit("균열 잡몹", "dark", "minion", 2200, 55, 28, Color(0.35, 0.1, 0.25))
	m.slot = slot
	return m


func alive(u: Dictionary) -> bool:
	return u.hp > 0.0


func living_heroes() -> Array:
	return heroes.filter(alive)


func living_minions() -> Array:
	return minions.filter(alive)


func _process(delta: float) -> void:
	if state != "battle":
		field.tick(delta)
		return
	var dt := delta * speed
	elapsed += dt
	field.tick(dt)
	for u in heroes + [boss] + minions:
		u.flash = maxf(u.flash - dt, 0.0)
		u.lunge = maxf(u.lunge - dt, 0.0)
		u.taunt = maxf(u.taunt - dt, 0.0)
	if chain_timer > 0.0:
		chain_timer -= dt
		if chain_timer <= 0.0:
			chain = 0
			last_ult_hero = -1

	for i in heroes.size():
		var h: Dictionary = heroes[i]
		if not alive(h):
			continue
		h.gauge += h.spd * dt * 2.0
		if h.gauge >= 100.0:
			h.gauge -= 100.0
			_hero_attack(i)
		h.ult_held = h.ult_held + dt if h.ult >= 100.0 else 0.0
	if auto_mode:
		_auto_ults()

	for m in living_minions():
		m.gauge += m.spd * dt * 2.0
		if m.gauge >= 100.0:
			m.gauge -= 100.0
			_enemy_attack(m, 1.0)
	_update_boss(dt)
	_check_phase()
	_check_end()


# 아군 행동 -------------------------------------------------------------

func _hero_attack(i: int) -> void:
	var h: Dictionary = heroes[i]
	var target := _pick_enemy()
	if target.is_empty():
		return
	h.lunge = 0.25
	_damage(target, h.atk * randf_range(0.9, 1.1), h, "")
	h.ult = minf(h.ult + 22.0, 100.0)


func _pick_enemy() -> Dictionary:
	var ms := living_minions()
	if not ms.is_empty():
		return ms[0]
	return boss if alive(boss) else {}


func can_ult(i: int) -> bool:
	return state == "battle" and alive(heroes[i]) and heroes[i].ult >= 100.0


func use_ult(i: int) -> void:
	if not can_ult(i):
		return
	var h: Dictionary = heroes[i]
	h.ult = 0.0
	h.ult_held = 0.0
	h.lunge = 0.4
	if chain_timer > 0.0 and last_ult_hero != i:
		chain += 1
	else:
		chain = 1
	chain_timer = CHAIN_WINDOW
	last_ult_hero = i
	var mult := 1.0 + 0.25 * (chain - 1)
	match h.role:
		"striker":
			var t := _pick_enemy()
			if not t.is_empty():
				_damage(t, h.atk * 4.2 * mult, h, "창격 일섬")
		"guardian":
			for a in living_heroes():
				a.shield = a.max_hp * 0.25
			h.taunt = 6.0
			_damage(boss, h.atk * 1.6 * mult, h, "대지의 방벽")
		"priest":
			for e in living_minions() + [boss]:
				_damage(e, h.atk * 2.3 * mult, h, "")
			for a in living_heroes():
				_heal(a, a.max_hp * 0.15)
			field.add_text(field.unit_pos(h), "물의 축복", Color(0.6, 0.85, 1.0), 34)
	field.add_ult(i, h.color)
	if chain >= 2:
		field.add_chain(chain)


func _auto_ults() -> void:
	var party_hp := 0.0
	var party_max := 0.0
	for a in living_heroes():
		party_hp += a.hp
		party_max += a.max_hp
	var ratio := party_hp / maxf(party_max, 1.0)
	for i in heroes.size():
		var h: Dictionary = heroes[i]
		if not can_ult(i):
			continue
		var go: bool = h.ult_held > 5.0
		if h.rule_on:
			match h.role:
				"striker":
					go = go or boss.hp / boss.max_hp < 0.3 or (chain_timer > 0.0 and last_ult_hero != i)
				"guardian":
					go = go or ratio < 0.6 or telegraph > 0.0
				"priest":
					go = go or (chain >= 2 and chain_timer > 0.0 and last_ult_hero != i) or not living_minions().is_empty()
		if go:
			use_ult(i)
			return


# 적 행동 ---------------------------------------------------------------

func _update_boss(dt: float) -> void:
	if not alive(boss):
		return
	if telegraph >= 0.0:
		telegraph -= dt
		if auto_mode and guard == "" and telegraph <= auto_guard_at:
			press_guard()
		if telegraph <= 0.0:
			_blast()
		return
	boss.gauge += boss.spd * dt * 2.0
	if boss.gauge >= 100.0:
		boss.gauge -= 100.0
		_enemy_attack(boss, 1.4)
	blast_timer -= dt
	if blast_timer <= 0.0:
		telegraph = TELEGRAPH_TIME
		guard = ""
		# 자동 방어는 일반 방어 구간 어딘가에서 누른다. 완벽 방어는 직접 눌러야 노리기 쉽다.
		auto_guard_at = randf_range(PERFECT_WINDOW + 0.1, GUARD_WINDOW)
		field.add_text(field.unit_pos(boss) + Vector2(0, -150), "균열 폭발 예고!", Color(1, 0.45, 0.4), 40)


func press_guard() -> void:
	if state != "battle" or telegraph < 0.0 or guard != "":
		return
	if telegraph <= PERFECT_WINDOW:
		guard = "perfect"
	elif telegraph <= GUARD_WINDOW:
		guard = "guard"
	else:
		guard = "early"
	field.add_guard(guard)


func _blast() -> void:
	telegraph = -1.0
	blast_timer = BLAST_INTERVAL
	var factor: float = {"perfect": 0.15, "guard": 0.5}.get(guard, 1.0)
	for h in living_heroes():
		_damage(h, boss.atk * 2.6 * factor, boss, "")
	field.add_blast()
	if guard == "perfect":
		perfect_count += 1
		_damage(boss, 1800.0, {}, "완벽 방어 반격")
		for h in living_heroes():
			h.ult = minf(h.ult + 25.0, 100.0)
	guard = ""


func _enemy_attack(e: Dictionary, mult: float) -> void:
	var targets := living_heroes()
	if targets.is_empty():
		return
	var taunting := targets.filter(func(h): return h.taunt > 0.0)
	var t: Dictionary = taunting[0] if not taunting.is_empty() else targets.pick_random()
	e.lunge = 0.25
	_damage(t, e.atk * mult * randf_range(0.85, 1.15), e, "")


func _check_phase() -> void:
	var r: float = boss.hp / boss.max_hp
	for p in 2:
		if not phase_spawned[p] and r < [0.66, 0.33][p]:
			phase_spawned[p] = true
			minions = [_minion(0), _minion(1)]
			field.add_text(field.unit_pos(boss) + Vector2(0, -150), "균열이 넓어진다!", Color(1, 0.6, 0.8), 36)


func _check_end() -> void:
	if not alive(boss):
		state = "win"
	elif living_heroes().is_empty():
		state = "lose"


func stars() -> int:
	var s := 1
	if elapsed < 100.0:
		s += 1
	if heroes.all(alive):
		s += 1
	return s


# 피해와 회복 -----------------------------------------------------------

func _damage(target: Dictionary, amount: float, source: Dictionary, label: String) -> void:
	if target.is_empty() or not alive(target):
		return
	var crit := false
	if target.role in ["boss", "minion"] and not source.is_empty():
		if source.element == BOSS_WEAKNESS and target.role == "boss":
			amount *= 1.5
		crit = randf() < 0.15
		if crit:
			amount *= 1.5
	if target.shield > 0.0:
		var absorbed := minf(target.shield, amount)
		target.shield -= absorbed
		amount -= absorbed
	target.hp = maxf(target.hp - amount, 0.0)
	target.flash = 0.15
	if target.role not in ["boss", "minion"]:
		target.ult = minf(target.ult + 6.0, 100.0)
	var color := Color(1, 0.35, 0.3) if target.role not in ["boss", "minion"] else (Color(1, 0.85, 0.3) if crit else Color.WHITE)
	field.add_text(field.unit_pos(target), str(int(amount)), color, 40 if crit else 30)
	if label != "":
		field.add_text(field.unit_pos(target) + Vector2(0, -60), label, Color(1, 0.9, 0.5), 34)


func _heal(target: Dictionary, amount: float) -> void:
	target.hp = minf(target.hp + amount, target.max_hp)
	field.add_text(field.unit_pos(target) + Vector2(0, -30), "+" + str(int(amount)), Color(0.5, 1, 0.6), 28)


# UI에서 부르는 조작 -----------------------------------------------------

func toggle_auto() -> void:
	auto_mode = not auto_mode


func toggle_speed() -> void:
	speed = 2 if speed == 1 else 1


func toggle_rule(i: int) -> void:
	heroes[i].rule_on = not heroes[i].rule_on
