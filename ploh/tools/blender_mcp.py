"""실행 중인 Blender의 MCP 애드온(포트 9876)에 파이썬 코드를 보내 실행한다.

사용:
    python3 blender_mcp.py script.py        # 파일 내용을 실행
    python3 blender_mcp.py -c "print(1)"    # 코드 한 줄 실행
Blender에 blender-mcp 애드온이 켜져 있어야 한다(자동 시작).
"""
import json
import socket
import sys


def send(command: dict, port: int = 9876, timeout: float = 600.0) -> dict:
    with socket.create_connection(("localhost", port), timeout) as s:
        s.sendall(json.dumps(command).encode())
        buf = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            try:
                return json.loads(buf.decode())
            except json.JSONDecodeError:
                continue
    return json.loads(buf.decode())


def main() -> None:
    code = sys.argv[2] if sys.argv[1] == "-c" else open(sys.argv[1], encoding="utf-8").read()
    reply = send({"type": "execute_code", "params": {"code": code}})
    if reply.get("status") == "success":
        print(reply["result"].get("result", ""), end="")
    else:
        print(json.dumps(reply, ensure_ascii=False, indent=1), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
