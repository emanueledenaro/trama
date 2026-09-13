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
