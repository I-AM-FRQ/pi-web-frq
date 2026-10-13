import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let sessionCounter = 0;
vi.mock("@/server/session-workspaces", () => ({
	createProjectPersistentSession: vi.fn(async () => ({ getSessionId: () => `session-test-${++sessionCounter}` })),
}));

const directory = await mkdtemp(join(tmpdir(), "pi-workbench-rooms-"));
vi.stubEnv("PI_WEB_ROOMS_PATH", join(directory, "rooms.json"));
const rooms = await import("./rooms");

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(directory, { recursive: true, force: true });
});

describe("Workbench rooms", () => {
	it("创建聊天室：角色与模型解耦，会话在首次响应时懒创建", async () => {
		const room = await rooms.createRoom({
			projectId: null,
			name: "多模型协作",
			roles: [{ role: "开发者", modelKey: "deepseek:deepseek-v4-flash" }, { role: "审查者", modelKey: "nvidia:meta/llama-3.3-70b-instruct" }],
		});
		expect(room.name).toBe("多模型协作");
		expect(room.participants).toHaveLength(2);
		expect(room.participants[0].role).toBe("开发者");
		expect(room.participants[1].modelKey).toBe("nvidia:meta/llama-3.3-70b-instruct");
		// 角色只是角色：创建时尚未绑定会话（会话在角色首次响应时创建）
		expect(room.participants.every((participant) => participant.sessionId === "")).toBe(true);
		const recorded = await rooms.setParticipantSession(room.id, room.participants[0].id, "session-abc");
		expect(recorded.participants[0].sessionId).toBe("session-abc");
		expect((await rooms.listRooms())[0].id).toBe(room.id);
	});

	it("角色名不能重复，模型标识必须合法", async () => {
		await expect(rooms.createRoom({
			name: "重复角色",
			roles: [{ role: "开发者", modelKey: "deepseek:deepseek-v4-flash" }, { role: "开发者", modelKey: "deepseek:deepseek-v4-pro" }],
		})).rejects.toThrow("角色名不能重复");
		await expect(rooms.createRoom({ name: "坏模型", roles: [{ role: "开发者", modelKey: "没有冒号" }] })).rejects.toThrow("模型标识");
		await expect(rooms.createRoom({ name: "空角色", roles: [] })).rejects.toThrow("至少需要一个角色");
	});

	it("更换模型不改变角色与会话上下文", async () => {
		const room = await rooms.createRoom({ name: "换模型", roles: [{ role: "开发者", modelKey: "deepseek:deepseek-v4-flash" }] });
		const participant = room.participants[0];
		const updated = await rooms.updateParticipant(room.id, participant.id, { modelKey: "deepseek:deepseek-v4-pro" });
		expect(updated.participants[0].modelKey).toBe("deepseek:deepseek-v4-pro");
		// 角色与会话 id 保持不变（仅换底层模型）
		expect(updated.participants[0].role).toBe("开发者");
		expect(updated.participants[0].sessionId).toBe(participant.sessionId);
	});

	it("可以改角色名，且不能与其他角色重名", async () => {
		const room = await rooms.createRoom({
			name: "改名",
			roles: [{ role: "A", modelKey: "deepseek:deepseek-v4-flash" }, { role: "B", modelKey: "deepseek:deepseek-v4-flash" }],
		});
		const renamed = await rooms.updateParticipant(room.id, room.participants[0].id, { role: "架构师" });
		expect(renamed.participants[0].role).toBe("架构师");
		await expect(rooms.updateParticipant(room.id, room.participants[1].id, { role: "架构师" })).rejects.toThrow("角色名不能重复");
	});

	it("群聊消息公开，私聊消息必须带目标且只对该角色可见", async () => {
		const room = await rooms.createRoom({ name: "消息", roles: [{ role: "开发者", modelKey: "deepseek:deepseek-v4-flash" }] });
		const publicMessage = await rooms.appendRoomMessage({ roomId: room.id, sender: { type: "user" }, content: "大家好" });
		expect(publicMessage.visibility).toBe("room");
		const participantId = room.participants[0].id;
		const privateMessage = await rooms.appendRoomMessage({
			roomId: room.id,
			sender: { type: "user" },
			content: "你单独看下这个问题",
			visibility: "private",
			targetParticipantId: participantId,
		});
		expect(privateMessage.visibility).toBe("private");
		expect(privateMessage.targetParticipantId).toBe(participantId);

		const messages = await rooms.listRoomMessages(room.id);
		expect(messages.map((message) => message.content)).toEqual(["大家好", "你单独看下这个问题"]);
		await expect(rooms.appendRoomMessage({ roomId: room.id, sender: { type: "user" }, content: "缺目标", visibility: "private" })).rejects.toThrow("私聊消息必须指定目标");
		await expect(rooms.appendRoomMessage({ roomId: room.id, sender: { type: "user" }, content: "   " })).rejects.toThrow("不能为空");
	});

	it("按项目过滤房间，且删除后不再出现", async () => {
		const first = await rooms.createRoom({ projectId: "project-aaaaaaaa", name: "项目A房间", roles: [{ role: "甲", modelKey: "deepseek:deepseek-v4-flash" }] });
		await rooms.createRoom({ projectId: null, name: "无项目房间", roles: [{ role: "乙", modelKey: "deepseek:deepseek-v4-flash" }] });
		expect((await rooms.listRooms("project-aaaaaaaa")).map((room) => room.name)).toEqual(["项目A房间"]);
		expect((await rooms.listRooms(null)).map((room) => room.name)).toEqual(["无项目房间"]);
		await rooms.deleteRoom(first.id);
		expect(await rooms.getRoom(first.id)).toBeUndefined();
		await expect(rooms.deleteRoom(first.id)).rejects.toThrow("聊天室不存在");
	});

	it("至少保留一个角色，且支持新增角色", async () => {
		const room = await rooms.createRoom({ name: "角色管理", roles: [{ role: "甲", modelKey: "deepseek:deepseek-v4-flash" }] });
		await expect(rooms.removeParticipant(room.id, room.participants[0].id)).rejects.toThrow("至少需要保留一个角色");
		const added = await rooms.addParticipant(room.id, { role: "乙", modelKey: "deepseek:deepseek-v4-pro" });
		expect(added.participants.map((participant) => participant.role)).toEqual(["甲", "乙"]);
		const removed = await rooms.removeParticipant(room.id, added.participants[1].id);
		expect(removed.participants.map((participant) => participant.role)).toEqual(["甲"]);
	});

	it("重命名房间并校验长度", async () => {
		const room = await rooms.createRoom({ name: "旧名", roles: [{ role: "甲", modelKey: "deepseek:deepseek-v4-flash" }] });
		const renamed = await rooms.renameRoom(room.id, "新名字");
		expect(renamed.name).toBe("新名字");
		await expect(rooms.renameRoom(room.id, "")).rejects.toThrow("房间名称长度");
	});
});
