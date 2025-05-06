import asyncio
import websockets

connected = set()

async def handler(websocket, path):
    # Enregistre le client
    connected.add(websocket)
    try:
        async for message in websocket:
            # Réémet le message à tous les autres clients
            for conn in connected:
                if conn != websocket:
                    await conn.send(message)
    finally:
        connected.remove(websocket)

start_server = websockets.serve(handler, "0.0.0.0", 3000)

print("Signaling server running on ws://localhost:3000")
loop = asyncio.get_event_loop
loop.run_until_complete(start_server)
loop.run_forever()
