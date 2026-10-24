extends SceneTree
## 개발용: 몸 메시의 정점 법선이 그 삼각형의 실제 면 방향(감긴 순서)과 맞는지 센다.
## 법선이 면과 반대면 툰 셰이더가 빛을 등진 것으로 보고 그늘색으로 칠한다(얼굴이 검게 나온다)
func _init() -> void:
	for path in ["res://assets/astrid/B_mid/astrid.glb", "res://assets/fram/fram.glb", "res://assets/schneider/schneider.glb", "res://assets/soldiers/boss/boss.glb", "res://assets/soldiers/conscript/conscript.glb"]:
		var m: Node3D = load(path).instantiate()
		for mi: MeshInstance3D in m.find_children("*", "MeshInstance3D", true, false):
			if mi.mesh == null or mi.name.begins_with("weapon"):
				continue
			var agree := 0
			var oppose := 0
			for s in mi.mesh.get_surface_count():
				var arr := mi.mesh.surface_get_arrays(s)
				var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
				var ns: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
				var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
				for k in range(0, idx.size(), 3):
					var a := vs[idx[k]]
					var b := vs[idx[k + 1]]
					var c := vs[idx[k + 2]]
					# Godot은 시계 방향이 앞면
					var fn := (c - a).cross(b - a)
					if fn.length() < 1e-10:
						continue
					fn = fn.normalized()
					var vn := (ns[idx[k]] + ns[idx[k + 1]] + ns[idx[k + 2]]).normalized()
					if fn.dot(vn) >= 0.0:
						agree += 1
					else:
						oppose += 1
			print(path.get_file(), " ", mi.name, " tris agree=", agree, " oppose=", oppose)
		m.free()
	quit()
