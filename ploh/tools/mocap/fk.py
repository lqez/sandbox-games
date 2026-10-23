"""Forward kinematics + motion metrics on glTF data (numpy). Coordinates: glTF (Y up, character faces +Z, +X = character's left)."""
import numpy as np
import gltfio as G


def q2m(q):
    x, y, z, w = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    m = np.empty(q.shape[:-1] + (3, 3))
    m[..., 0, 0] = 1 - 2 * (y * y + z * z); m[..., 0, 1] = 2 * (x * y - z * w); m[..., 0, 2] = 2 * (x * z + y * w)
    m[..., 1, 0] = 2 * (x * y + z * w); m[..., 1, 1] = 1 - 2 * (x * x + z * z); m[..., 1, 2] = 2 * (y * z - x * w)
    m[..., 2, 0] = 2 * (x * z - y * w); m[..., 2, 1] = 2 * (y * z + x * w); m[..., 2, 2] = 1 - 2 * (x * x + y * y)
    return m


def m2q(m):
    """rotation matrix (...,3,3) -> quaternion xyzw"""
    m = np.asarray(m)
    tr = m[..., 0, 0] + m[..., 1, 1] + m[..., 2, 2]
    q = np.empty(m.shape[:-2] + (4,))
    flat_m = m.reshape(-1, 3, 3); flat_q = q.reshape(-1, 4); flat_t = tr.reshape(-1)
    for i in range(len(flat_m)):
        M = flat_m[i]; t = flat_t[i]
        if t > 0:
            s = np.sqrt(t + 1.0) * 2
            flat_q[i] = [(M[2, 1] - M[1, 2]) / s, (M[0, 2] - M[2, 0]) / s, (M[1, 0] - M[0, 1]) / s, 0.25 * s]
        elif M[0, 0] > M[1, 1] and M[0, 0] > M[2, 2]:
            s = np.sqrt(1.0 + M[0, 0] - M[1, 1] - M[2, 2]) * 2
            flat_q[i] = [0.25 * s, (M[0, 1] + M[1, 0]) / s, (M[0, 2] + M[2, 0]) / s, (M[2, 1] - M[1, 2]) / s]
        elif M[1, 1] > M[2, 2]:
            s = np.sqrt(1.0 + M[1, 1] - M[0, 0] - M[2, 2]) * 2
            flat_q[i] = [(M[0, 1] + M[1, 0]) / s, 0.25 * s, (M[1, 2] + M[2, 1]) / s, (M[0, 2] - M[2, 0]) / s]
        else:
            s = np.sqrt(1.0 + M[2, 2] - M[0, 0] - M[1, 1]) * 2
            flat_q[i] = [(M[0, 2] + M[2, 0]) / s, (M[1, 2] + M[2, 1]) / s, 0.25 * s, (M[1, 0] - M[0, 1]) / s]
    return G.qnorm(q)


def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0); bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)


def qinv(q):
    return q * np.array([-1, -1, -1, 1.0])


def qang(a, b):
    d = np.abs(np.sum(G.qnorm(a) * G.qnorm(b), -1))
    return np.degrees(2 * np.arccos(np.clip(d, 0, 1)))


class Rig:
    def __init__(self, base_glb, node_override=None):
        j, binc = G.read_glb(base_glb)
        for n in j["nodes"]:
            n.update((node_override or {}).get(n.get("name"), {}))
        self.j, self.binc = j, binc
        self.names = G.node_names(j)
        self.parent = {}
        for i, n in enumerate(j["nodes"]):
            for c in n.get("children", []):
                self.parent[self.names[c]] = self.names[i]
        self.joints = [self.names[i] for i in j["skins"][0]["joints"]]
        self.rest = G.joint_rest(j)
        # order joints parent-first
        order = []
        def visit(b):
            if b in order: return
            p = self.parent.get(b)
            if p in self.joints: visit(p)
            order.append(b)
        for b in self.joints: visit(b)
        self.order = order
        # weapons: mesh nodes parented to joints
        self.weapons = {}
        for i, n in enumerate(j["nodes"]):
            nm = self.names[i]
            if nm.startswith("weapon_") and "mesh" in n:
                pos = G.acc(j, binc, j["meshes"][n["mesh"]]["primitives"][0]["attributes"]["POSITION"])
                allp = [pos]
                for p in j["meshes"][n["mesh"]]["primitives"][1:]:
                    allp.append(G.acc(j, binc, p["attributes"]["POSITION"]))
                pos = np.concatenate(allp)
                T, R, S = self.rest[nm]
                loc = (q2m(R) @ (pos * S).T).T + T          # in hand-bone space
                k = np.argmax(np.linalg.norm(loc, axis=1))
                # Blender exports object-local +Z as glTF +Y: the blade/shaft axis is the direction grip -> tip
                ax = loc[k] - T
                self.weapons[nm] = {"bone": self.parent[nm], "tip": loc[k], "verts": loc,
                                    "edge": q2m(R) @ np.array([1.0, 0, 0]), "axis": ax / np.linalg.norm(ax)}

    def fk(self, bones):
        """bones: name -> {T,R,S} arrays (n,..). returns name -> (pos (n,3), rot (n,3,3)) in armature space."""
        out = {}
        for b in self.order:
            T = bones[b]["T"]; R = q2m(G.qnorm(bones[b]["R"])); S = bones[b]["S"]
            p = self.parent.get(b)
            if p in out:
                pp, pr = out[p]
                pos = pp + np.einsum("nij,nj->ni", pr, T)
                rot = pr @ R
            else:
                pos, rot = T.copy(), R
            out[b] = (pos, rot)
        return out

    def tip(self, g, wname):
        w = self.weapons[wname]
        pos, rot = g[w["bone"]]
        return pos + np.einsum("nij,j->ni", rot, w["tip"])


def metrics(rig, clip, wname=None, fps=30):
    bones = clip["bones"]
    g = rig.fk(bones)
    n = next(iter(bones.values()))["R"].shape[0]
    res = {"n": n}
    hp = g["Hips"][0]
    res["hips_xz"] = hp[:, [0, 2]]
    res["hips_y"] = hp[:, 1]
    fwd = g["Hips"][1] @ np.array([0, 0, 1.0])  # hips local +Z?  (rest hips ~ identity => +Z forward)
    res["yaw"] = np.degrees(np.arctan2(fwd[:, 0], fwd[:, 2]))
    if wname:
        tp = rig.tip(g, wname)
        sp = np.r_[0, np.linalg.norm(np.diff(tp, axis=0), axis=1) * fps]
        res["tip"] = tp; res["speed"] = sp; res["strike"] = int(np.argmax(sp))
        W = rig.weapons[wname]; hr = g[W["bone"]][1]
        edge = np.einsum("nij,j->ni", hr, W["edge"]); vel = np.r_[np.zeros((1, 3)), np.diff(tp, axis=0)]
        vn = np.linalg.norm(vel, axis=1) + 1e-9
        res["edge_align"] = np.abs(np.sum(edge * vel, 1)) / vn   # 1 = edge leads, 0 = flat leads / stab
    feet = {}
    for side in ("Left", "Right"):
        f = g[side + "Foot"][0]; t = g[side + "ToeBase"][0]
        feet[side] = (f, t)
    res["feet"] = feet
    res["g"] = g
    return res
