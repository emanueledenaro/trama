import Foundation
import XCTest
@testable import TramaCore

final class CodexClientTests: XCTestCase {
    func testListModelsUsesTheAuthenticatedCodexCatalogAndPaginates() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "model/list":
                let params = message["params"] as? [String: Any]
                if params?["cursor"] as? String == "page-2" {
                    transport.respond(to: message, result: [
                        "data": [[
                            "id": "gpt-5.6-luna",
                            "model": "gpt-5.6-luna",
                            "displayName": "GPT-5.6 Luna",
                            "description": "Per attività rapide",
                            "isDefault": false,
                            "hidden": false
                        ]],
                        "nextCursor": NSNull()
                    ])
                } else {
                    transport.respond(to: message, result: [
                        "data": [
                            [
                                "id": "gpt-5.6-terra",
                                "model": "gpt-5.6-terra",
                                "displayName": "GPT-5.6 Terra",
                                "description": "Equilibrio tra capacità e costo",
                                "isDefault": true,
                                "hidden": false
                            ],
                            [
                                "id": "custom/example",
                                "model": "custom/example",
                                "displayName": "Provider esterno",
                                "description": "Voce aggiunta alla configurazione globale",
                                "isDefault": false,
                                "hidden": false
                            ]
                        ],
                        "nextCursor": "page-2"
                    ])
                }
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        let models = try await client.listModels()

        XCTAssertEqual(models.map(\.model), ["gpt-5.6-terra", "gpt-5.6-luna"])
        XCTAssertEqual(models.first?.displayName, "GPT-5.6 Terra")
        XCTAssertEqual(models.first?.description, "Equilibrio tra capacità e costo")
        XCTAssertEqual(models.first?.isDefault, true)
        XCTAssertEqual(transport.methods, ["initialize", "initialized", "account/read", "model/list", "model/list"])
        let requests = transport.messages.filter { $0["method"] as? String == "model/list" }
        let firstParams = try XCTUnwrap(requests.first?["params"] as? [String: Any])
        XCTAssertEqual(firstParams["includeHidden"] as? Bool, false)
        XCTAssertEqual(firstParams["limit"] as? Int, 100)
        XCTAssertNil(firstParams["cursor"])
        let secondParams = try XCTUnwrap(requests.last?["params"] as? [String: Any])
        XCTAssertEqual(secondParams["cursor"] as? String, "page-2")
    }

    func testPlanRejectsAnExternalProviderBeforeStartingCodex() async {
        let transport = FakeCodexTransport()
        let client = CodexClient(transport: transport)

        do {
            _ = try await client.plan(
                prompt: "Prepara un piano",
                cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
                model: "custom/example"
            )
            XCTFail("Expected external model rejection")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .invalidModel("custom/example"))
        }
        XCTAssertTrue(transport.methods.isEmpty)
    }

    func testConnectUsesExistingChatGPTAccountAfterHandshake() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(
                    to: message,
                    result: Self.initializeResult,
                    splitAt: 17
                )
            case "account/read":
                transport.respond(to: message, result: [
                    "account": [
                        "type": "chatgpt",
                        "email": "person@example.com",
                        "planType": "plus",
                        "futureField": true
                    ],
                    "requiresOpenaiAuth": true
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        let account = try await client.connect()
        let serverInfo = await client.serverInfo()

        XCTAssertEqual(account, .chatGPT(email: "person@example.com", plan: "plus"))
        XCTAssertEqual(serverInfo?.platformOS, "macos")
        XCTAssertEqual(
            transport.methods,
            ["initialize", "initialized", "account/read"]
        )
    }

    func testLoginReadsAccountBeforeStartingManagedChatGPTFlow() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: [
                    "account": NSNull(),
                    "requiresOpenaiAuth": true
                ])
            case "account/login/start":
                transport.respond(to: message, result: [
                    "type": "chatgpt",
                    "loginId": "login-1",
                    "authUrl": "https://chatgpt.com/auth/example"
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        let account = try await client.connect()
        XCTAssertEqual(account, .signedOut)
        let url = try await client.startLogin()

        XCTAssertEqual(url.absoluteString, "https://chatgpt.com/auth/example")
        XCTAssertEqual(
            transport.methods,
            [
                "initialize",
                "initialized",
                "account/read",
                "account/read",
                "account/login/start"
            ]
        )
        let login = try XCTUnwrap(transport.messages.last)
        let params = try XCTUnwrap(login["params"] as? [String: Any])
        XCTAssertEqual(params["type"] as? String, "chatgpt")
        XCTAssertNil(params["apiKey"])
    }

    func testConnectRejectsAPIKeyAccount() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: [
                    "account": ["type": "apiKey"],
                    "requiresOpenaiAuth": true
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        do {
            _ = try await client.connect()
            XCTFail("Expected API key account rejection")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .unsupportedAccount("apiKey"))
        }
    }

    func testPlanEnforcesReadOnlyContractStreamsAndDeclinesApproval() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "thread/start":
                transport.respond(to: message, result: [
                    "thread": ["id": "thread-1"],
                    "model": "test-model"
                ])
            case "turn/start":
                transport.respond(to: message, result: [
                    "turn": ["id": "turn-1", "status": "inProgress", "items": []]
                ])
                transport.emit([
                    "method": "item/commandExecution/requestApproval",
                    "id": "approval-1",
                    "params": [
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "itemId": "item-command"
                    ]
                ])
                transport.emit([
                    "method": "item/agentMessage/delta",
                    "params": [
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "itemId": "item-answer",
                        "delta": "Piano in corso"
                    ]
                ], splitAt: 23)
                transport.emit([
                    "method": "item/completed",
                    "params": [
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "item": [
                            "type": "agentMessage",
                            "id": "item-answer",
                            "text": "Piano finale",
                            "phase": "final_answer"
                        ]
                    ]
                ])
                transport.emit([
                    "method": "turn/completed",
                    "params": [
                        "threadId": "thread-1",
                        "turn": ["id": "turn-1", "status": "completed", "items": []]
                    ]
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        _ = try await client.connect()
        let streamed = LockedStrings()
        let result = try await client.plan(
            prompt: "Prepara il piano",
            cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
            model: "gpt-6-astra",
            outputSchema: Data("""
            {"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}
            """.utf8)
        ) { streamed.append($0) }

        XCTAssertEqual(result, "Piano finale")
        XCTAssertEqual(streamed.values, ["Piano in corso"])

        let threadStart = try XCTUnwrap(transport.message(method: "thread/start"))
        let threadParams = try XCTUnwrap(threadStart["params"] as? [String: Any])
        XCTAssertEqual(threadParams["modelProvider"] as? String, "openai")
        XCTAssertEqual(threadParams["model"] as? String, "gpt-6-astra")
        XCTAssertEqual(threadParams["approvalPolicy"] as? String, "never")
        XCTAssertEqual(threadParams["sandbox"] as? String, "read-only")
        XCTAssertEqual(threadParams["ephemeral"] as? Bool, true)
        let config = try XCTUnwrap(threadParams["config"] as? [String: Any])
        XCTAssertEqual(config["web_search"] as? String, "disabled")
        let features = try XCTUnwrap(config["features"] as? [String: Any])
        XCTAssertEqual(features["apps"] as? Bool, false)
        XCTAssertEqual(features["plugins"] as? Bool, false)
        let apps = try XCTUnwrap(config["apps"] as? [String: Any])
        let appDefault = try XCTUnwrap(apps["_default"] as? [String: Any])
        XCTAssertEqual(appDefault["enabled"] as? Bool, false)
        let drive = try XCTUnwrap(apps["google_drive"] as? [String: Any])
        XCTAssertEqual(drive["enabled"] as? Bool, false)
        XCTAssertNil(config["mcp_servers"])
        XCTAssertFalse(transport.methods.contains("config/value/write"))
        XCTAssertFalse(transport.methods.contains("config/batchWrite"))
        XCTAssertFalse(transport.methods.contains("config/read"))

        let turnStart = try XCTUnwrap(transport.message(method: "turn/start"))
        let turnParams = try XCTUnwrap(turnStart["params"] as? [String: Any])
        XCTAssertEqual(turnParams["approvalPolicy"] as? String, "never")
        let sandbox = try XCTUnwrap(turnParams["sandboxPolicy"] as? [String: Any])
        XCTAssertEqual(sandbox["type"] as? String, "readOnly")
        XCTAssertEqual(sandbox["networkAccess"] as? Bool, false)
        let outputSchema = try XCTUnwrap(turnParams["outputSchema"] as? [String: Any])
        XCTAssertEqual(outputSchema["type"] as? String, "object")
        XCTAssertNotNil(outputSchema["properties"])

        let approvalResponse = try XCTUnwrap(transport.message(id: "approval-1"))
        let approvalResult = try XCTUnwrap(approvalResponse["result"] as? [String: Any])
        XCTAssertEqual(approvalResult["decision"] as? String, "decline")
    }

    func testCancelTurnInterruptsTheActivePlan() async throws {
        let transport = FakeCodexTransport()
        let turnStarted = expectation(description: "turn/start sent")
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-cancel"]])
            case "turn/start":
                transport.respond(to: message, result: [
                    "turn": ["id": "turn-cancel", "status": "inProgress", "items": []]
                ])
                turnStarted.fulfill()
            case "turn/interrupt":
                transport.respond(to: message, result: [:])
                transport.emit([
                    "method": "turn/completed",
                    "params": [
                        "threadId": "thread-cancel",
                        "turn": [
                            "id": "turn-cancel",
                            "status": "interrupted",
                            "items": []
                        ]
                    ]
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        _ = try await client.connect()
        let task = Task {
            try await client.plan(
                prompt: "Piano da annullare",
                cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            )
        }
        await fulfillment(of: [turnStarted], timeout: 1)
        await client.cancelTurn()

        do {
            _ = try await task.value
            XCTFail("Expected interrupted turn")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .turnInterrupted)
        }
    }

    func testExecuteUsesWorkspaceSandboxAndRoutesCommandAndFileApprovals() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            let method = message["method"] as? String
            switch method {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-execute"]])
            case "turn/start":
                transport.respond(to: message, result: [
                    "turn": ["id": "turn-execute", "status": "inProgress", "items": []]
                ])
                transport.emit([
                    "method": "item/commandExecution/requestApproval",
                    "id": "command-approval",
                    "params": [
                        "threadId": "thread-execute",
                        "turnId": "turn-execute",
                        "itemId": "command-item",
                        "command": "swift test",
                        "cwd": "/tmp/project",
                        "reason": "Eseguire i test"
                    ]
                ])
            case nil where message["id"] as? String == "command-approval":
                transport.emit([
                    "method": "item/fileChange/requestApproval",
                    "id": "file-approval",
                    "params": [
                        "threadId": "thread-execute",
                        "turnId": "turn-execute",
                        "itemId": "file-item",
                        "reason": "Aggiornare il file"
                    ]
                ])
            case nil where message["id"] as? String == "file-approval":
                transport.emit([
                    "method": "execCommandApproval",
                    "id": "legacy-command-approval",
                    "params": [
                        "conversationId": "thread-execute",
                        "command": ["swift", "test"],
                        "cwd": "/tmp/project",
                        "reason": "Conferma legacy"
                    ]
                ])
            case nil where message["id"] as? String == "legacy-command-approval":
                transport.emit([
                    "method": "applyPatchApproval",
                    "id": "legacy-file-approval",
                    "params": [
                        "conversationId": "thread-execute",
                        "reason": "Conferma modifica legacy"
                    ]
                ])
            case nil where message["id"] as? String == "legacy-file-approval":
                transport.emitCompletedResponse(
                    threadID: "thread-execute",
                    turnID: "turn-execute",
                    text: "Lavoro completato"
                )
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        _ = try await client.connect()
        let approvals = LockedApprovalRequests()
        let response = try await client.execute(
            prompt: "Esegui la modifica",
            cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
            model: "gpt-5.6-luna",
            onApproval: { request in
                approvals.append(request)
                return request.kind == "command" ? .allowOnce : .decline
            }
        )

        XCTAssertEqual(response, "Lavoro completato")
        XCTAssertEqual(
            approvals.values.map(\.id),
            [
                "command-approval",
                "file-approval",
                "legacy-command-approval",
                "legacy-file-approval"
            ]
        )
        XCTAssertEqual(
            approvals.values.map(\.kind),
            ["command", "fileChange", "command", "fileChange"]
        )

        let threadStart = try XCTUnwrap(transport.message(method: "thread/start"))
        let threadParams = try XCTUnwrap(threadStart["params"] as? [String: Any])
        XCTAssertEqual(threadParams["approvalPolicy"] as? String, "on-request")
        XCTAssertEqual(threadParams["sandbox"] as? String, "workspace-write")
        XCTAssertEqual(threadParams["model"] as? String, "gpt-5.6-luna")
        let restrictedConfig = try XCTUnwrap(threadParams["config"] as? [String: Any])
        let restrictedFeatures = try XCTUnwrap(restrictedConfig["features"] as? [String: Any])
        XCTAssertEqual(restrictedFeatures["apps"] as? Bool, false)
        XCTAssertNil(restrictedConfig["mcp_servers"])

        let turnStart = try XCTUnwrap(transport.message(method: "turn/start"))
        let turnParams = try XCTUnwrap(turnStart["params"] as? [String: Any])
        XCTAssertEqual(turnParams["approvalPolicy"] as? String, "on-request")
        let sandbox = try XCTUnwrap(turnParams["sandboxPolicy"] as? [String: Any])
        XCTAssertEqual(sandbox["type"] as? String, "workspaceWrite")
        XCTAssertEqual(sandbox["networkAccess"] as? Bool, false)
        XCTAssertEqual(sandbox["excludeTmpdirEnvVar"] as? Bool, true)
        XCTAssertEqual(sandbox["excludeSlashTmp"] as? Bool, true)
        XCTAssertEqual(
            sandbox["writableRoots"] as? [String],
            [FileManager.default.currentDirectoryPath]
        )

        let commandResponse = try XCTUnwrap(transport.message(id: "command-approval"))
        let commandResult = try XCTUnwrap(commandResponse["result"] as? [String: Any])
        XCTAssertEqual(commandResult["decision"] as? String, "accept")
        let fileResponse = try XCTUnwrap(transport.message(id: "file-approval"))
        let fileResult = try XCTUnwrap(fileResponse["result"] as? [String: Any])
        XCTAssertEqual(fileResult["decision"] as? String, "decline")
        let legacyCommand = try XCTUnwrap(transport.message(id: "legacy-command-approval"))
        let legacyCommandResult = try XCTUnwrap(legacyCommand["result"] as? [String: Any])
        XCTAssertEqual(legacyCommandResult["decision"] as? String, "approved")
        let legacyFile = try XCTUnwrap(transport.message(id: "legacy-file-approval"))
        let legacyFileResult = try XCTUnwrap(legacyFile["result"] as? [String: Any])
        let legacyDecision = try XCTUnwrap(legacyFileResult["decision"] as? [String: Any])
        XCTAssertNotNil(legacyDecision["denied"])
    }

    func testCancelTurnDeclinesPendingExecutionApproval() async throws {
        let transport = FakeCodexTransport()
        let approvalPresented = expectation(description: "approval presented")
        transport.onMessage = { message in
            let method = message["method"] as? String
            switch method {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-pending"]])
            case "turn/start":
                transport.respond(to: message, result: [
                    "turn": ["id": "turn-pending", "status": "inProgress", "items": []]
                ])
                transport.emit([
                    "method": "item/commandExecution/requestApproval",
                    "id": "pending-approval",
                    "params": [
                        "threadId": "thread-pending",
                        "turnId": "turn-pending",
                        "itemId": "command-pending",
                        "command": "touch file"
                    ]
                ])
            case "turn/interrupt":
                transport.respond(to: message, result: [:])
                transport.emit([
                    "method": "turn/completed",
                    "params": [
                        "threadId": "thread-pending",
                        "turn": ["id": "turn-pending", "status": "interrupted", "items": []]
                    ]
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        _ = try await client.connect()
        let execution = Task {
            try await client.execute(
                prompt: "Modifica",
                cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
                onApproval: { _ in
                    approvalPresented.fulfill()
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 10_000_000)
                    }
                    return .allowOnce
                }
            )
        }

        await fulfillment(of: [approvalPresented], timeout: 1)
        await client.cancelTurn()

        do {
            _ = try await execution.value
            XCTFail("Expected interrupted execution")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .turnInterrupted)
        }

        let response = try XCTUnwrap(transport.message(id: "pending-approval"))
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        XCTAssertEqual(result["decision"] as? String, "decline")
    }

    func testStopDeclinesPendingApprovalAndEndsExecutionAsInterrupted() async throws {
        let transport = FakeCodexTransport()
        let approvalPresented = expectation(description: "approval presented before stop")
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-stop"]])
            case "turn/start":
                transport.respond(to: message, result: [
                    "turn": ["id": "turn-stop", "status": "inProgress", "items": []]
                ])
                transport.emit([
                    "method": "item/fileChange/requestApproval",
                    "id": "stop-approval",
                    "params": [
                        "threadId": "thread-stop",
                        "turnId": "turn-stop",
                        "itemId": "file-stop",
                        "reason": "Modificare un file"
                    ]
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        _ = try await client.connect()
        let execution = Task {
            try await client.execute(
                prompt: "Modifica",
                cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
                onApproval: { _ in
                    approvalPresented.fulfill()
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 10_000_000)
                    }
                    return .allowOnce
                }
            )
        }

        await fulfillment(of: [approvalPresented], timeout: 1)
        client.stop()

        do {
            _ = try await execution.value
            XCTFail("Expected stop to interrupt execution")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .turnInterrupted)
        }

        let response = try XCTUnwrap(transport.message(id: "stop-approval"))
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        XCTAssertEqual(result["decision"] as? String, "decline")
    }

    func testPlanStopsBeforeModelTurnWhenMCPRemainsExposed() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-unsafe"]])
            case "mcpServerStatus/list":
                transport.respond(to: message, result: [
                    "data": [["name": "still-enabled", "tools": ["write": [:]]]],
                    "nextCursor": NSNull()
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        _ = try await client.connect()
        do {
            _ = try await client.plan(
                prompt: "Prepara il piano",
                cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            )
            XCTFail("Expected tool isolation failure")
        } catch {
            guard case let .toolIsolationUnavailable(detail) = error as? CodexClient.ClientError else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertTrue(detail.contains("still-enabled"))
        }

        XCTAssertFalse(transport.methods.contains("turn/start"))
        XCTAssertFalse(transport.methods.contains("config/value/write"))
        XCTAssertFalse(transport.methods.contains("config/batchWrite"))
    }

    func testPlanRejectsNonObjectOutputSchemaBeforeStartingThread() async throws {
        let transport = FakeCodexTransport()
        let client = CodexClient(transport: transport)

        do {
            _ = try await client.plan(
                prompt: "Piano",
                cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
                outputSchema: Data("[]".utf8)
            )
            XCTFail("Expected invalid schema")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .invalidOutputSchema)
        }
        XCTAssertFalse(transport.methods.contains("thread/start"))
    }

    func testListSkillsReadsCurrentCodexCatalogForWorkingDirectory() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "skills/list":
                transport.respond(to: message, result: [
                    "data": [[
                        "cwd": FileManager.default.currentDirectoryPath,
                        "skills": [
                            ["name": "tdd", "path": "/skills/tdd/SKILL.md", "enabled": true],
                            ["name": "review", "path": "/skills/review/SKILL.md", "enabled": false]
                        ],
                        "errors": []
                    ]]
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let skills = try await client.listSkills(cwd: cwd)

        XCTAssertEqual(skills, [
            .init(name: "review", path: "/skills/review/SKILL.md", enabled: false),
            .init(name: "tdd", path: "/skills/tdd/SKILL.md", enabled: true)
        ])
        let request = try XCTUnwrap(transport.message(method: "skills/list"))
        let params = try XCTUnwrap(request["params"] as? [String: Any])
        XCTAssertEqual(params["forceReload"] as? Bool, true)
        XCTAssertEqual(params["cwds"] as? [String], [cwd.path])
    }

    func testListAppsMergesDirectoryAndInstalledRuntimeState() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "app/list":
                transport.respond(to: message, result: [
                    "data": [[
                        "id": "github",
                        "name": "GitHub",
                        "description": "Repository connector",
                        "installUrl": "https://chatgpt.com/apps/github",
                        "isAccessible": true,
                        "isEnabled": true
                    ]],
                    "nextCursor": NSNull()
                ])
            case "app/installed":
                transport.respond(to: message, result: [
                    "apps": [[
                        "id": "github",
                        "runtimeName": "GitHub",
                        "enabled": false,
                        "callable": false
                    ]]
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        _ = try await client.connect()
        let apps = try await client.listApps()

        XCTAssertEqual(apps.count, 1)
        XCTAssertEqual(apps[0].id, "github")
        XCTAssertEqual(apps[0].installURL?.absoluteString, "https://chatgpt.com/apps/github")
        XCTAssertTrue(apps[0].isAccessible)
        XCTAssertFalse(apps[0].isEnabled)
        XCTAssertTrue(apps[0].isInstalled)
        XCTAssertFalse(apps[0].isCallable)
    }

    func testProcessExitFailsPendingRequestAndIncludesStderr() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.emitStderr("authentication helper stopped")
                transport.exit(status: 9)
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        do {
            _ = try await client.connect()
            XCTFail("Expected process exit")
        } catch {
            XCTAssertEqual(
                error as? CodexClient.ClientError,
                .processExited(status: 9, stderr: "authentication helper stopped")
            )
        }
    }

    func testMalformedJSONAndTimeoutFailClosed() async throws {
        let malformedTransport = FakeCodexTransport()
        malformedTransport.onMessage = { message in
            if message["method"] as? String == "initialize" {
                malformedTransport.emitRaw(Data("{bad json}\n".utf8))
            }
        }
        let malformedClient = CodexClient(transport: malformedTransport)
        do {
            _ = try await malformedClient.connect()
            XCTFail("Expected malformed message")
        } catch {
            guard case .malformedMessage = error as? CodexClient.ClientError else {
                return XCTFail("Unexpected error: \(error)")
            }
        }

        let silentTransport = FakeCodexTransport()
        let silentClient = CodexClient(
            transport: silentTransport,
            requestTimeout: 0.05,
            turnTimeout: 0.1
        )
        do {
            _ = try await silentClient.connect()
            XCTFail("Expected timeout")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .timedOut("initialize"))
        }
    }

    func testProcessArgumentsPinOpenAIWithoutShellOrAPIKey() {
        XCTAssertEqual(Array(CodexClient.appServerArguments.prefix(2)), ["app-server", "--stdio"])
        XCTAssertTrue(CodexClient.appServerArguments.contains("model_provider=\"openai\""))
        XCTAssertTrue(
            CodexClient.appServerArguments.contains(
                "openai_base_url=\"https://chatgpt.com/backend-api/codex\""
            )
        )
        XCTAssertFalse(CodexClient.appServerArguments.joined().contains("apiKey"))
        XCTAssertFalse(CodexClient.appServerArguments.joined().contains("/bin/sh"))
    }

    func testRestrictedRuntimeBuildsCompleteInertMCPOverrides() throws {
        let fileManager = FileManager.default
        let candidates = [
            fileManager.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/codex"),
            URL(fileURLWithPath: "/opt/homebrew/bin/codex"),
            URL(fileURLWithPath: "/usr/local/bin/codex")
        ]
        guard let codex = candidates.first(where: {
            fileManager.isExecutableFile(atPath: $0.path)
        }) else {
            throw XCTSkip("Codex CLI is not installed")
        }

        let arguments = try CodexClient.restrictedAppServerArguments(codexURL: codex)
        XCTAssertTrue(arguments.contains("--disable"))
        XCTAssertTrue(arguments.contains("apps"))
        let overrides = arguments.enumerated().compactMap { index, value -> String? in
            guard value == "-c", arguments.indices.contains(index + 1) else { return nil }
            return arguments[index + 1]
        }.filter { $0.hasPrefix("mcp_servers.") }
        XCTAssertFalse(overrides.isEmpty)
        XCTAssertTrue(overrides.allSatisfy {
            $0.contains("enabled=false")
                && ($0.contains("command=\"/usr/bin/false\"")
                    || $0.contains("url=\"http://127.0.0.1:9/mcp\""))
        })
        XCTAssertFalse(overrides.contains { $0 == "enabled=false" })
    }

    func testRestrictedRuntimeInventoryTimeoutFailsClosed() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent(".scratch/codex-inventory-tests/\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("codex")
        try Data("#!/bin/sh\nsleep 2\n".utf8).write(to: executable)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: executable.path
        )

        XCTAssertThrowsError(try CodexClient.restrictedAppServerArguments(
            codexURL: executable,
            inventoryTimeout: 0.05
        )) { error in
            guard case let CodexClient.ClientError.toolIsolationUnavailable(detail) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertTrue(detail.contains("timeout"))
        }
    }

    // MARK: Coordinator thread

    private static let coordinatorSettings = CodexClient.CoordinatorThreadSettings(
        cwd: URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        model: "gpt-5.5",
        developerInstructions: "You are the Trama Coordinator.",
        toolServerURL: URL(string: "http://127.0.0.1:52011/mcp")!
    )

    private static func respondToCoordinatorHandshake(_ transport: FakeCodexTransport, _ message: [String: Any]) {
        switch message["method"] as? String {
        case "initialize":
            transport.respond(to: message, result: initializeResult)
        case "account/read":
            transport.respond(to: message, result: chatGPTAccount)
        case "mcpServerStatus/list":
            let params = message["params"] as? [String: Any]
            if params?["threadId"] is String {
                transport.respond(to: message, result: [
                    "data": [["name": "trama", "tools": ["read_study": [:]]]],
                    "nextCursor": NSNull()
                ])
            }
        default:
            break
        }
    }

    func testCoordinatorThreadStartsAPersistentRestrictedThreadWithTramaTools() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            Self.respondToCoordinatorHandshake(transport, message)
            if message["method"] as? String == "thread/start" {
                transport.respond(to: message, result: ["thread": ["id": "thread-c1"], "model": "gpt-5.5"])
            }
        }

        let client = CodexClient(transport: transport)
        let opening = try await client.openCoordinatorThread(Self.coordinatorSettings, resuming: nil)

        XCTAssertEqual(opening, .started(threadID: "thread-c1"))
        XCTAssertEqual(opening.threadID, "thread-c1")
        XCTAssertFalse(transport.methods.contains("thread/resume"))
        let start = try XCTUnwrap(transport.message(method: "thread/start"))
        let params = try XCTUnwrap(start["params"] as? [String: Any])
        XCTAssertEqual(params["ephemeral"] as? Bool, false)
        XCTAssertEqual(params["model"] as? String, "gpt-5.5")
        XCTAssertEqual(params["modelProvider"] as? String, "openai")
        XCTAssertEqual(params["sandbox"] as? String, "read-only")
        XCTAssertEqual(params["approvalPolicy"] as? String, "never")
        XCTAssertEqual(params["developerInstructions"] as? String, "You are the Trama Coordinator.")
        XCTAssertEqual(params["cwd"] as? String, FileManager.default.currentDirectoryPath)
        let config = try XCTUnwrap(params["config"] as? [String: Any])
        XCTAssertEqual(config["web_search"] as? String, "disabled")
        let features = try XCTUnwrap(config["features"] as? [String: Any])
        XCTAssertEqual(features["multi_agent"] as? Bool, false)
        XCTAssertEqual(features["apps"] as? Bool, false)
        let apps = try XCTUnwrap(config["apps"] as? [String: Any])
        XCTAssertEqual((apps["_default"] as? [String: Any])?["enabled"] as? Bool, false)
        // A whole mcp_servers table would replace the process overrides that switch the global servers
        // off (checked on Codex 0.154.0); the dotted key adds trama and keeps them.
        XCTAssertNil(config["mcp_servers"])
        XCTAssertNil(config["shell_environment_policy"])
        let trama = try XCTUnwrap(config["mcp_servers.trama"] as? [String: Any])
        XCTAssertEqual(trama["url"] as? String, "http://127.0.0.1:52011/mcp")
        XCTAssertEqual(trama["bearer_token_env_var"] as? String, "TRAMA_COORDINATOR_TOKEN")
        XCTAssertEqual(trama["default_tools_approval_mode"] as? String, "approve")
        XCTAssertEqual(config["shell_environment_policy.exclude"] as? [String], ["TRAMA_COORDINATOR_TOKEN"])
        let verified = transport.messages.contains { message in
            message["method"] as? String == "mcpServerStatus/list"
                && (message["params"] as? [String: Any])?["threadId"] as? String == "thread-c1"
        }
        XCTAssertTrue(verified)
    }

    func testCoordinatorThreadResumesWithTheSameRestrictedConfiguration() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            Self.respondToCoordinatorHandshake(transport, message)
            if message["method"] as? String == "thread/resume" {
                transport.respond(to: message, result: ["thread": ["id": "thread-c1"], "model": "gpt-5.5"])
            }
        }

        let client = CodexClient(transport: transport)
        let opening = try await client.openCoordinatorThread(Self.coordinatorSettings, resuming: "thread-c1")

        XCTAssertEqual(opening, .resumed(threadID: "thread-c1"))
        XCTAssertFalse(transport.methods.contains("thread/start"))
        let resume = try XCTUnwrap(transport.message(method: "thread/resume"))
        let params = try XCTUnwrap(resume["params"] as? [String: Any])
        XCTAssertEqual(params["threadId"] as? String, "thread-c1")
        XCTAssertEqual(params["model"] as? String, "gpt-5.5")
        XCTAssertEqual(params["excludeTurns"] as? Bool, true)
        XCTAssertEqual(params["sandbox"] as? String, "read-only")
        XCTAssertEqual(params["approvalPolicy"] as? String, "never")
        XCTAssertEqual(params["developerInstructions"] as? String, "You are the Trama Coordinator.")
        let config = try XCTUnwrap(params["config"] as? [String: Any])
        let trama = try XCTUnwrap(config["mcp_servers.trama"] as? [String: Any])
        XCTAssertEqual(trama["bearer_token_env_var"] as? String, "TRAMA_COORDINATOR_TOKEN")
        XCTAssertEqual(((config["features"] as? [String: Any])?["multi_agent"]) as? Bool, false)
    }

    func testCoordinatorThreadReplacesAThreadCodexNoLongerHas() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            Self.respondToCoordinatorHandshake(transport, message)
            switch message["method"] as? String {
            case "thread/resume":
                transport.emit([
                    "id": message["id"]!,
                    "error": ["code": -32600, "message": "no rollout found for thread id thread-old"]
                ])
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-new"]])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        let opening = try await client.openCoordinatorThread(Self.coordinatorSettings, resuming: "thread-old")

        guard case let .replaced(previous, threadID, reason) = opening else {
            return XCTFail("Expected a replaced thread, got \(opening)")
        }
        XCTAssertEqual(previous, "thread-old")
        XCTAssertEqual(threadID, "thread-new")
        XCTAssertTrue(reason.contains("no rollout found"))
        XCTAssertEqual(transport.methods.filter { $0 == "thread/start" || $0 == "thread/resume" }, ["thread/resume", "thread/start"])
        let start = try XCTUnwrap(transport.message(method: "thread/start"))
        XCTAssertEqual((start["params"] as? [String: Any])?["ephemeral"] as? Bool, false)
    }

    func testCoordinatorThreadKeepsTheThreadWhenResumeFailsForAnotherReason() async throws {
        for failure in ["model not found: gpt-0", "usage limit reached", "invalid request"] {
            let transport = FakeCodexTransport()
            transport.onMessage = { message in
                Self.respondToCoordinatorHandshake(transport, message)
                if message["method"] as? String == "thread/resume" {
                    transport.emit(["id": message["id"]!, "error": ["code": -32600, "message": failure]])
                }
            }

            let client = CodexClient(transport: transport)
            do {
                _ = try await client.openCoordinatorThread(Self.coordinatorSettings, resuming: "thread-c1")
                XCTFail("Expected \(failure) to fail")
            } catch {
                XCTAssertEqual(error as? CodexClient.ClientError, .rpcError(code: -32600, message: failure))
            }
            XCTAssertFalse(transport.methods.contains("thread/start"), failure)
        }
    }

    func testCoordinatorThreadRejectsAResumeThatReturnsAnotherThread() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            Self.respondToCoordinatorHandshake(transport, message)
            if message["method"] as? String == "thread/resume" {
                transport.respond(to: message, result: ["thread": ["id": "thread-other"]])
            }
        }

        let client = CodexClient(transport: transport)
        do {
            _ = try await client.openCoordinatorThread(Self.coordinatorSettings, resuming: "thread-c1")
            XCTFail("Expected a mismatched resume to fail")
        } catch {
            guard case .malformedMessage = error as? CodexClient.ClientError else {
                return XCTFail("Unexpected error: \(error)")
            }
        }
        XCTAssertFalse(transport.methods.contains("thread/start"))
    }

    func testCoordinatorThreadRefusesMCPServersOtherThanTrama() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize":
                transport.respond(to: message, result: Self.initializeResult)
            case "account/read":
                transport.respond(to: message, result: Self.chatGPTAccount)
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-c1"]])
            case "mcpServerStatus/list":
                transport.respond(to: message, result: [
                    "data": [
                        ["name": "trama", "tools": ["read_study": [:]]],
                        ["name": "github", "tools": ["create_issue": [:]]]
                    ],
                    "nextCursor": NSNull()
                ])
            default:
                break
            }
        }

        let client = CodexClient(transport: transport)
        do {
            _ = try await client.openCoordinatorThread(Self.coordinatorSettings, resuming: nil)
            XCTFail("Expected tool isolation failure")
        } catch {
            guard case let .toolIsolationUnavailable(detail) = error as? CodexClient.ClientError else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertTrue(detail.contains("github"))
            XCTAssertFalse(detail.contains("trama"))
        }
    }

    func testCoordinatorTurnStreamsProseAndReportsToolCallsAndNotes() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            Self.respondToCoordinatorHandshake(transport, message)
            guard message["method"] as? String == "turn/start" else { return }
            transport.respond(to: message, result: ["turn": ["id": "turn-c1", "status": "inProgress", "items": []]])
            let base: [String: Any] = ["threadId": "thread-c1", "turnId": "turn-c1"]
            transport.emit(["method": "turn/started", "params": ["threadId": "thread-c1", "turn": ["id": "turn-c1"]]])
            transport.emit(["method": "item/started", "params": base.merging(["item": ["type": "agentMessage", "id": "note", "text": "", "phase": "commentary"]]) { $1 }])
            transport.emit(["method": "item/agentMessage/delta", "params": base.merging(["itemId": "note", "delta": "Leggo lo studio."]) { $1 }])
            transport.emit(["method": "item/completed", "params": base.merging(["item": ["type": "agentMessage", "id": "note", "text": "Leggo lo studio.", "phase": "commentary"]]) { $1 }])
            transport.emit(["method": "item/started", "params": base.merging(["item": ["type": "mcpToolCall", "id": "call-1", "server": "trama", "tool": "read_study", "status": "inProgress", "arguments": [:]]]) { $1 }])
            transport.emit(["method": "item/completed", "params": base.merging(["item": ["type": "mcpToolCall", "id": "call-1", "server": "trama", "tool": "read_study", "status": "completed", "result": ["content": [["type": "text", "text": "## Codice"]]], "error": NSNull()]]) { $1 }])
            transport.emit(["method": "item/started", "params": base.merging(["item": ["type": "mcpToolCall", "id": "call-2", "server": "trama", "tool": "write_memory", "status": "inProgress", "arguments": ["text": "x"]]]) { $1 }])
            transport.emit(["method": "item/completed", "params": base.merging(["item": ["type": "mcpToolCall", "id": "call-2", "server": "trama", "tool": "write_memory", "status": "failed", "error": ["message": "tool timed out"]]]) { $1 }])
            transport.emit(["method": "item/started", "params": base.merging(["item": ["type": "agentMessage", "id": "answer", "text": "", "phase": "final_answer"]]) { $1 }])
            transport.emit(["method": "item/agentMessage/delta", "params": base.merging(["itemId": "answer", "delta": "Mancano "]) { $1 }])
            transport.emit(["method": "item/agentMessage/delta", "params": base.merging(["itemId": "answer", "delta": "i test."]) { $1 }])
            transport.emitCompletedResponse(threadID: "thread-c1", turnID: "turn-c1", text: "Mancano i test.")
        }

        let client = CodexClient(transport: transport)
        let events = LockedTurnEvents()
        let reply = try await client.runCoordinatorTurn(
            threadID: "thread-c1",
            input: ["Aggiornamento dello studio", "Cosa manca per la beta?"],
            settings: Self.coordinatorSettings
        ) { events.append($0) }

        XCTAssertEqual(reply, "Mancano i test.")
        XCTAssertEqual(events.values, [
            .turnStarted(turnID: "turn-c1"),
            .commentary("Leggo lo studio."),
            .toolCallStarted(itemID: "call-1", server: "trama", tool: "read_study"),
            .toolCallCompleted(itemID: "call-1", server: "trama", tool: "read_study", succeeded: true, error: nil),
            .toolCallStarted(itemID: "call-2", server: "trama", tool: "write_memory"),
            .toolCallCompleted(itemID: "call-2", server: "trama", tool: "write_memory", succeeded: false, error: "tool timed out"),
            .textDelta("Mancano "),
            .textDelta("i test.")
        ])
        let start = try XCTUnwrap(transport.message(method: "turn/start"))
        let params = try XCTUnwrap(start["params"] as? [String: Any])
        XCTAssertEqual(params["threadId"] as? String, "thread-c1")
        XCTAssertEqual(params["model"] as? String, "gpt-5.5")
        XCTAssertEqual(params["approvalPolicy"] as? String, "never")
        XCTAssertNil(params["outputSchema"])
        let sandbox = try XCTUnwrap(params["sandboxPolicy"] as? [String: Any])
        XCTAssertEqual(sandbox["type"] as? String, "readOnly")
        XCTAssertEqual(sandbox["networkAccess"] as? Bool, false)
        let input = try XCTUnwrap(params["input"] as? [[String: Any]])
        XCTAssertEqual(input.compactMap { $0["text"] as? String }, ["Aggiornamento dello studio", "Cosa manca per la beta?"])
        XCTAssertFalse(transport.methods.contains("thread/start"))
    }

    func testCoordinatorNeverFallsBackToTheCodexDefaultModel() async {
        // Without a model, Codex would use the default of the person's config.toml.
        var settings = Self.coordinatorSettings
        settings.model = "  "
        let transport = FakeCodexTransport()
        let client = CodexClient(transport: transport)
        for resuming in [nil, "thread-c1"] {
            do {
                _ = try await client.openCoordinatorThread(settings, resuming: resuming)
                XCTFail("Expected a missing model to be refused")
            } catch {
                XCTAssertEqual(error as? CodexClient.ClientError, .invalidModel("  "))
            }
        }
        do {
            _ = try await client.runCoordinatorTurn(threadID: "thread-c1", input: ["Ciao"], settings: settings) { _ in }
            XCTFail("Expected a missing model to be refused")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .invalidModel("  "))
        }
        XCTAssertTrue(transport.methods.isEmpty)
    }

    func testCoordinatorTurnRejectsEmptyInputBeforeCallingCodex() async {
        let transport = FakeCodexTransport()
        let client = CodexClient(transport: transport)
        do {
            _ = try await client.runCoordinatorTurn(threadID: "thread-c1", input: ["  ", ""], settings: Self.coordinatorSettings) { _ in }
            XCTFail("Expected empty prompt")
        } catch {
            XCTAssertEqual(error as? CodexClient.ClientError, .emptyPrompt)
        }
        XCTAssertTrue(transport.methods.isEmpty)
    }

    func testCoordinatorTurnSendsImagesSkillsAndAnExplicitEffort() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            Self.respondToCoordinatorHandshake(transport, message)
            guard message["method"] as? String == "turn/start" else { return }
            transport.respond(to: message, result: ["turn": ["id": "turn-e1", "status": "inProgress", "items": []]])
            transport.emitCompletedResponse(threadID: "thread-c1", turnID: "turn-e1", text: "Fatto.")
        }
        var settings = Self.coordinatorSettings
        settings.effort = "high"
        let client = CodexClient(transport: transport)
        let reply = try await client.runCoordinatorTurn(
            threadID: "thread-c1",
            input: [.text("Guarda $tdd"), .text("  "), .localImage(path: "/tmp/trama/a.png"), .skill(name: "tdd", path: "/p/tdd/SKILL.md")],
            settings: settings
        ) { _ in }

        XCTAssertEqual(reply, "Fatto.")
        let start = try XCTUnwrap(transport.message(method: "turn/start"))
        let params = try XCTUnwrap(start["params"] as? [String: Any])
        XCTAssertEqual(params["effort"] as? String, "high")
        XCTAssertEqual(params["model"] as? String, "gpt-5.5")
        let input = try XCTUnwrap(params["input"] as? [[String: Any]])
        XCTAssertEqual(input.count, 3)
        XCTAssertEqual(input[0]["type"] as? String, "text")
        XCTAssertEqual(input[0]["text"] as? String, "Guarda $tdd")
        XCTAssertEqual(input[1]["type"] as? String, "localImage")
        XCTAssertEqual(input[1]["path"] as? String, "/tmp/trama/a.png")
        XCTAssertEqual(input[2]["type"] as? String, "skill")
        XCTAssertEqual(input[2]["name"] as? String, "tdd")
        XCTAssertEqual(input[2]["path"] as? String, "/p/tdd/SKILL.md")
    }

    func testCoordinatorTurnWithoutEffortLeavesItOut() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            Self.respondToCoordinatorHandshake(transport, message)
            guard message["method"] as? String == "turn/start" else { return }
            transport.respond(to: message, result: ["turn": ["id": "turn-e2", "status": "inProgress", "items": []]])
            transport.emitCompletedResponse(threadID: "thread-c1", turnID: "turn-e2", text: "Fatto.")
        }
        let client = CodexClient(transport: transport)
        _ = try await client.runCoordinatorTurn(threadID: "thread-c1", input: ["Ciao"], settings: Self.coordinatorSettings) { _ in }
        let params = try XCTUnwrap(transport.message(method: "turn/start")?["params"] as? [String: Any])
        XCTAssertNil(params["effort"])
    }

    func testCoordinatorThreadObserverReceivesUsageAndCompactionOfItsThreadOnly() async throws {
        let usage: (String, Int) -> [String: Any] = { threadID, used in
            ["method": "thread/tokenUsage/updated", "params": [
                "threadId": threadID, "turnId": "turn-u1",
                "tokenUsage": [
                    "total": ["totalTokens": used * 3, "inputTokens": used * 3 - 10, "cachedInputTokens": 0, "cacheWriteInputTokens": 0, "outputTokens": 10, "reasoningOutputTokens": 0],
                    "last": ["totalTokens": used, "inputTokens": used - 10, "cachedInputTokens": 0, "cacheWriteInputTokens": 0, "outputTokens": 10, "reasoningOutputTokens": 0],
                    "modelContextWindow": 258_400
                ]
            ]]
        }
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            Self.respondToCoordinatorHandshake(transport, message)
            guard message["method"] as? String == "turn/start" else { return }
            transport.respond(to: message, result: ["turn": ["id": "turn-u1", "status": "inProgress", "items": []]])
            let base: [String: Any] = ["threadId": "thread-c1", "turnId": "turn-u1"]
            transport.emit(usage("thread-c1", 40_000))
            transport.emit(usage("child-thread", 99_000))
            transport.emit(["method": "item/started", "params": base.merging(["item": ["type": "contextCompaction", "id": "cc-1"]]) { $1 }])
            transport.emit(["method": "thread/compacting", "params": base])
            transport.emit(["method": "item/updated", "params": base.merging(["item": ["type": "contextCompaction", "id": "cc-1", "status": "inProgress"]]) { $1 }])
            transport.emit(["method": "item/started", "params": ["threadId": "child-thread", "turnId": "x", "item": ["type": "contextCompaction", "id": "cc-2"]]])
            transport.emit(["method": "item/completed", "params": base.merging(["item": ["type": "contextCompaction", "id": "cc-1"]]) { $1 }])
            transport.emitCompletedResponse(threadID: "thread-c1", turnID: "turn-u1", text: "Fatto.")
            transport.emit(usage("thread-c1", 12_000))
            transport.emit(["method": "item/completed", "params": base.merging(["item": ["type": "contextCompaction", "id": "cc-3", "status": "failed"]]) { $1 }])
            transport.emit(["method": "thread/compacted", "params": ["threadId": "thread-c1", "turnId": "turn-u1"]])
        }
        let client = CodexClient(transport: transport)
        let events = LockedThreadEvents()
        await client.observeThread("thread-c1") { events.append($0) }
        _ = try await client.runCoordinatorTurn(threadID: "thread-c1", input: ["Ciao"], settings: Self.coordinatorSettings) { _ in }

        let deadline = Date().addingTimeInterval(2)
        while events.values.count < 8, Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(events.values, [
            .contextUsage(ContextUsageSnapshot(usedTokens: 40_000, maxTokens: 258_400, totalProcessedTokens: 120_000, inputTokens: 39_990, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0)),
            .compaction(.inProgress),
            .compaction(.inProgress),
            .compaction(.inProgress),
            .compaction(.completed),
            .contextUsage(ContextUsageSnapshot(usedTokens: 12_000, maxTokens: 258_400, totalProcessedTokens: 36_000, inputTokens: 11_990, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0)),
            .compaction(.failed),
            .compaction(.completed)
        ])

        await client.observeThread("thread-c1", nil)
        transport.emit(usage("thread-c1", 50_000))
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(events.values.count, 8)
    }

    func testListModelsReadsTheReasoningEffortsOfEachModel() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "account/read": transport.respond(to: message, result: Self.chatGPTAccount)
            case "model/list":
                transport.respond(to: message, result: [
                    "data": [
                        ["id": "a", "model": "a", "displayName": "A", "description": "", "isDefault": true, "hidden": false,
                         "supportedReasoningEfforts": [["reasoningEffort": "low", "description": "Fast"], ["reasoningEffort": "high", "description": "Deep"]],
                         "defaultReasoningEffort": "high"],
                        ["id": "b", "model": "b", "displayName": "B", "description": "", "isDefault": false, "hidden": false,
                         "supportedReasoningEfforts": ["medium"], "defaultReasoningEffort": "xhigh"],
                        ["id": "c", "model": "c", "displayName": "C", "description": "", "isDefault": false, "hidden": false]
                    ],
                    "nextCursor": NSNull()
                ])
            default: break
            }
        }
        let models = try await CodexClient(transport: transport).listModels()
        XCTAssertEqual(models.map(\.supportedReasoningEfforts), [["low", "high"], ["medium"], []])
        XCTAssertEqual(models.map(\.defaultReasoningEffort), ["high", nil, nil])
    }

    func testListSkillsKeepsTheShortDescription() async throws {
        let root = FileManager.default.temporaryDirectory
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "skills/list":
                transport.respond(to: message, result: ["data": [[
                    "cwd": root.path,
                    "errors": [],
                    "skills": [
                        ["name": "tdd", "path": "/p/tdd/SKILL.md", "enabled": true, "description": "Long", "interface": ["shortDescription": "Test first"]],
                        ["name": "grill", "path": "/p/grill/SKILL.md", "enabled": true, "description": "Grill the plan"],
                        ["name": "bare", "path": "/p/bare/SKILL.md", "enabled": false]
                    ]
                ]]])
            default: break
            }
        }
        let skills = try await CodexClient(transport: transport).listSkills(cwd: root)
        XCTAssertEqual(skills.map(\.name), ["bare", "grill", "tdd"])
        XCTAssertEqual(skills.map(\.description), [nil, "Grill the plan", "Test first"])
    }

    func testCoordinatorRuntimeCarriesTheTokenOnlyInItsProcessEnvironment() {
        let environment = CodexClient.coordinatorEnvironment(token: "trama_session_secret", base: ["PATH": "/usr/bin", "TRAMA_COORDINATOR_TOKEN": "stale"])
        XCTAssertEqual(environment["TRAMA_COORDINATOR_TOKEN"], "trama_session_secret")
        XCTAssertEqual(environment["PATH"], "/usr/bin")
        let settingsDescription = String(describing: Self.coordinatorSettings)
        XCTAssertFalse(settingsDescription.contains("trama_session_secret"))
    }

    func testCoordinatorRuntimeRefusesAGlobalMCPServerNamedTrama() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent(".scratch/codex-inventory-tests/\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("codex")
        let inventory = #"[{"name":"trama","transport":{"type":"stdio"}},{"name":"github","transport":{"type":"streamable_http"}}]"#
        try Data("#!/bin/sh\necho '\(inventory)'\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

        let plain = try CodexClient.restrictedAppServerArguments(codexURL: executable)
        XCTAssertTrue(plain.contains("mcp_servers.github={url=\"http://127.0.0.1:9/mcp\",enabled=false}"))
        XCTAssertThrowsError(try CodexClient.restrictedAppServerArguments(codexURL: executable, reservedServerName: "trama")) { error in
            guard case let CodexClient.ClientError.toolIsolationUnavailable(detail) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertTrue(detail.contains("trama"))
        }
    }

    private static let initializeResult: [String: Any] = [
        "userAgent": "Codex Desktop/0.148.0 (Mac OS; arm64) dumb (trama; 0.1.0)",
        "codexHome": "/tmp/codex-home",
        "platformFamily": "unix",
        "platformOs": "macos"
    ]

    private static let chatGPTAccount: [String: Any] = [
        "account": [
            "type": "chatgpt",
            "email": "person@example.com",
            "planType": "plus"
        ],
        "requiresOpenaiAuth": true
    ]
}

private final class LockedStrings: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var values: [String] {
        lock.withLock { storage }
    }

    func append(_ value: String) {
        lock.withLock { storage.append(value) }
    }
}

private final class LockedTurnEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [CodexClient.CoordinatorTurnEvent] = []

    var values: [CodexClient.CoordinatorTurnEvent] {
        lock.withLock { storage }
    }

    func append(_ value: CodexClient.CoordinatorTurnEvent) {
        lock.withLock { storage.append(value) }
    }
}

private final class LockedThreadEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [CodexClient.ThreadEvent] = []

    var values: [CodexClient.ThreadEvent] {
        lock.withLock { storage }
    }

    func append(_ value: CodexClient.ThreadEvent) {
        lock.withLock { storage.append(value) }
    }
}

private final class LockedApprovalRequests: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [CodexClient.ApprovalRequest] = []

    var values: [CodexClient.ApprovalRequest] {
        lock.withLock { storage }
    }

    func append(_ value: CodexClient.ApprovalRequest) {
        lock.withLock { storage.append(value) }
    }
}

private final class FakeCodexTransport: CodexTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncStream<CodexTransportEvent>.Continuation?
    private var storedMessages: [[String: Any]] = []
    var onMessage: (([String: Any]) -> Void)?

    var messages: [[String: Any]] {
        lock.withLock { storedMessages }
    }

    var methods: [String] {
        messages.compactMap { $0["method"] as? String }
    }

    func start() throws -> AsyncStream<CodexTransportEvent> {
        AsyncStream { continuation in
            lock.withLock { self.continuation = continuation }
        }
    }

    func send(_ data: Data) throws {
        let line = data.last == 0x0A ? data.dropLast() : data[...]
        let object = try JSONSerialization.jsonObject(with: Data(line))
        guard let message = object as? [String: Any] else {
            throw CodexClient.ClientError.transport("test message was not an object")
        }
        lock.withLock { storedMessages.append(message) }
        onMessage?(message)
        respondToIsolationPreflight(message)
    }

    func stop() {
        let continuation = lock.withLock { () -> AsyncStream<CodexTransportEvent>.Continuation? in
            let continuation = self.continuation
            self.continuation = nil
            return continuation
        }
        continuation?.finish()
    }

    func respond(to request: [String: Any], result: Any, splitAt: Int? = nil) {
        guard let id = request["id"] else { return }
        emit(["id": id, "result": result], splitAt: splitAt)
    }

    func emit(_ object: [String: Any], splitAt: Int? = nil) {
        let data = try! JSONSerialization.data(withJSONObject: object) + Data([0x0A])
        if let splitAt, splitAt > 0, splitAt < data.count {
            emitRaw(data.prefix(splitAt))
            emitRaw(data.dropFirst(splitAt))
        } else {
            emitRaw(data)
        }
    }

    func emitCompletedResponse(threadID: String, turnID: String, text: String) {
        emit([
            "method": "item/completed",
            "params": [
                "threadId": threadID,
                "turnId": turnID,
                "item": [
                    "type": "agentMessage",
                    "id": "final-response",
                    "text": text,
                    "phase": "final_answer"
                ]
            ]
        ])
        emit([
            "method": "turn/completed",
            "params": [
                "threadId": threadID,
                "turn": ["id": turnID, "status": "completed", "items": []]
            ]
        ])
    }

    func emitRaw<S: DataProtocol>(_ data: S) {
        let continuation = lock.withLock { self.continuation }
        continuation?.yield(.stdout(Data(data)))
    }

    func emitStderr(_ string: String) {
        let continuation = lock.withLock { self.continuation }
        continuation?.yield(.stderr(Data(string.utf8)))
    }

    func exit(status: Int32) {
        let continuation = lock.withLock { self.continuation }
        continuation?.yield(.exited(status))
        continuation?.finish()
    }

    func message(method: String) -> [String: Any]? {
        messages.first { $0["method"] as? String == method }
    }

    func message(id: String) -> [String: Any]? {
        messages.first { $0["id"] as? String == id }
    }

    private func respondToIsolationPreflight(_ message: [String: Any]) {
        switch message["method"] as? String {
        case "mcpServerStatus/list":
            let params = message["params"] as? [String: Any]
            let isThreadScoped = params?["threadId"] is String
            let data: [[String: Any]] = isThreadScoped ? [] : [["name": "github"]]
            respond(to: message, result: ["data": data, "nextCursor": NSNull()])
        case "app/installed":
            let params = message["params"] as? [String: Any]
            let isThreadScoped = params?["threadId"] is String
            respond(to: message, result: [
                "apps": [[
                    "id": "google_drive",
                    "runtimeName": "Google Drive",
                    "enabled": !isThreadScoped,
                    "callable": !isThreadScoped
                ]]
            ])
        default:
            break
        }
    }
}

private extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
