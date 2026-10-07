// The English texts of the main process (issue #301): the same keys and placeholders as `main.it.ts`, in plain English.
import type { mainIt } from "./main.it";

export const mainEn: Record<keyof typeof mainIt, string> = {
  // MARK: Controller: projects, turns, providers and the Coordinator
  // Developers, tools and practices
  "main.controller.selfPickDetail":
    "It was the next ready slice in its modules: the developer takes it without waiting for the Coordinator, within the mandate and the project's limit of parallel developers.",
  "main.controller.leftProjectNote":
    "You left the project while the Coordinator was replying.",
  "main.controller.readOutsideScopeDetail":
    "{path} is not part of the project: Trama does not let it be read.\nRequest: {tool}",
  "main.controller.choicesInTextTitle":
    "Choice written in the text instead of a card",
  "main.controller.toolRefusedDetail": "Request: {tool}\n{reason}",
  "main.controller.practiceProposedTitle":
    "Practice proposed: {title} (v{version})",
  "main.controller.practiceProposedDetail":
    "{method}\nYou find it in Memory: only you adopt it.",
  "main.controller.practiceAdoptedTitle": "Practice adopted: {title}",
  "main.controller.practiceRetiredTitle": "Practice retired: {title}",
  "main.controller.practiceRolledBackTitle":
    "Practice rolled back to the previous version: {title}",

  // Providers
  "main.controller.providerCodexAccountUnsupported":
    "Trama accepts only a ChatGPT account; Codex uses an account of type {type}.",
  "main.controller.providerAccountUnsupported":
    "{name} uses an account of type {type}, which Trama does not support.",
  "main.controller.providerBlockedTemporaryLimit":
    "{name} is blocked: it has a temporary limit.",
  "main.controller.providerBlockedQuotaExhausted":
    "{name} is blocked: it has used up the plan's quota.",
  "main.controller.providerUnlocksAt": "It unlocks on {date}.",
  "main.controller.providerWaitOrSwitch":
    "You can wait or choose another provider.",
  "main.controller.providerCodexSignedOut":
    "Connect ChatGPT from Connections to talk with the Coordinator.",
  "main.controller.providerSignInWithCommand":
    "Sign in to {name} with `{command}` in the terminal, then refresh the connections.",
  "main.controller.providerSignIn":
    "Sign in to {name}, then refresh the connections.",
  "main.controller.providerNotChecked": "{name} status not checked yet.",
  "main.controller.providerNoAdapter":
    "{name} does not have an adapter in Trama yet.",
  "main.controller.providerAccountCheckTimeout":
    "{name} did not answer the account check.",
  "main.controller.providerBackTitle": "{provider} is available again",
  "main.controller.providerBackDetail": "Trama resumes the assignment.",
  "main.controller.providerSwitchWait":
    "Wait for the end of the turn and the queue before changing provider.",
  "main.controller.providerSwitchTitle": "Coordinator on {provider}",
  "main.controller.providerSwitchDetail":
    "You moved the Coordinator from {from} to {to}. The conversation stays: {to} opens a new session and receives the project study, Memory and transcript.",
  "main.controller.providerSwitchProposal":
    "You can switch to {providers} with Change provider: they are already connected.",
  "main.controller.providerSwitchProposal.one":
    "You can switch to {providers} with Change provider: it is already connected.",
  "main.controller.providerBlockedTitle": "{provider} blocked",
  "main.controller.networkUnreachable":
    "Network unreachable: {message}. Trama tries again when the network is back and the person resumes the work.",

  // Retries and resumes of a turn
  "main.controller.retryReopenedTitle": "Turn resumed on reopening",
  "main.controller.retryReopenedDetail":
    "Trama resumes by itself, within the mandate, the turn that closing interrupted. The Coordinator first checks what was already done.",
  "main.controller.retryResumedTitle": "Turn resumed",
  "main.controller.retryResumedDetail":
    "Trama resumes the message of the interrupted turn. The Coordinator first checks what was already done.",
  "main.controller.retryManualTitle": "New attempt",
  "main.controller.retryManualDetail":
    "Trama tries the message of the failed turn again.",
  "main.controller.retryAutomaticTitle":
    "Automatic attempt ({attempt} of {max})",
  "main.controller.retryQuotaBackDetail":
    "The {provider} quota is available again: Trama resumes the message.",
  "main.controller.retryUnreachableDetail":
    "After the {provider} or network outage, Trama tries the message again.",
  "main.controller.retryTemporaryLimitDetail":
    "After the {provider} temporary limit, Trama tries the message again.",
  "main.controller.turnInterruptedTitle": "Turn interrupted",
  "main.controller.moveSetAsideTitle": "Move set aside for your message",
  "main.controller.moveSetAsideDetail": "Set aside for your message: Trama takes it up again later.",
  "main.controller.turnFailedTitle": "The turn failed",
  "main.controller.turnNotRepeatable": "This turn can no longer be repeated.",
  "main.controller.quotaWaitStoppedTitle": "Quota wait stopped",
  "main.controller.quotaWaitStoppedDetail":
    "Trama no longer waits for the {provider} quota: the turn starts again only when you ask.",
  "main.controller.retriesStoppedTitle": "Automatic attempts stopped",
  "main.controller.retriesStoppedDetail":
    "You stopped the attempts with {provider}.",
  "main.controller.resumeSkippedTitle": "Not resumed",
  "main.controller.resumeOutsideMandate":
    "The mandate no longer covers this assignment.",
  "main.controller.assignmentResumedOnReopeningTitle":
    "Assignment resumed on reopening",
  "main.controller.assignmentResumedOnReopeningDetail":
    "Trama resumes the assignment in its working copy, as it was at closing.",

  // Projects
  "main.controller.projectMoved":
    "The project {name} is no longer in {path}: it was moved or deleted. Reopen it from its new location or remove it from the recent projects.",
  "main.controller.projectReadOnly": "This project's state is read-only.",
  "main.controller.projectNotOpen": "Open a project.",
  "main.controller.folderUnreadable": "The folder cannot be read: {path}",
  "main.controller.folderIsFile": "Choose a folder, not a file.",
  "main.controller.folderIsRoot":
    "Choose a project folder, not the disk root or the Home folder.",
  "main.controller.folderNameInvalid": "Choose a valid folder name.",
  "main.controller.repositoryNeedsGh": "GitHub CLI is not connected: connect it from the Welcome page and create the repository from there.",
  "main.controller.repositoryNotCreated": "The project is created, but the GitHub repository is not: {reason}",
  "main.controller.folderExists":
    "A folder named {name} already exists in this location.",
  "main.controller.cloneRepositoryInvalid":
    "Write the repository as owner/name or paste its GitHub address.",
  "main.controller.legacyImportTitle":
    "Conversation imported from the SwiftUI version",
  "main.controller.legacyImportDetail":
    "Conversation, Pact, mandate, Memory and the Coordinator's thread come from the previous app. The original file stays unchanged.",
  "main.controller.orphanStopConfirmedTitle": "Stop confirmed",
  "main.controller.demoWithoutGitHub": "Example project without GitHub.",
  "main.controller.demoProjectName": "Example project",

  // GitHub, conflicts and presence
  "main.controller.githubRemoteNotGitHub":
    "The origin remote does not point to GitHub.",
  "main.controller.githubIssuesUnreadable":
    "GitHub CLI could not read the issues: {reason}",
  "main.controller.githubNotLinked": "No GitHub repository linked.",
  "main.controller.githubIssueTitleMissing": "Write a title for the issue.",
  "main.controller.conflictCardTitle": "Conflict",
  "main.controller.conflictNotifyTitle": "Trama: conflict with {references}",
  "main.controller.conflictNotifyBody":
    "Candidate {candidate} conflicts with {references}.",
  "main.controller.branchDivergenceNotifyTitle":
    "Trama: the project branch went in another direction",
  "main.controller.presenceConsentTitle": "Share your presence?",
  "main.controller.presenceConsentConflictDetail":
    "Your work overlaps with {who}. With shared presence you would have noticed sooner.",
  "main.controller.presenceColleagueFallback": "a colleague's work",
  "main.controller.presenceDemo":
    "The example project does not share presence.",
  "main.controller.presenceChooseFirst": "First choose to share your presence.",
  "main.controller.colleagueCommentInvalid":
    "The message is empty or too long.",
  "main.controller.colleaguePullRequestNotOpen":
    "Pull request #{number} is not among the open ones.",

  // Coordinator
  "main.controller.coordinatorModelNotInCatalog":
    "The model {model} is no longer in the {provider} catalog. Choose another one from the composer.",
  "main.controller.coordinatorNoModels":
    "{provider} returned no available models.",
  "main.controller.coordinatorNotReady": "The Coordinator is not ready.",
  "main.controller.assignmentCardTitle": "Assignment",
  "main.controller.newThreadTitle": "New Coordinator thread",
  "main.controller.newThreadDetail":
    "The Coordinator's previous session is no longer available. The Coordinator starts again from the project study and Memory.",
  "main.controller.studyCardTitle": "Project study",
  "main.controller.messageSentTitle": "Message sent to the Coordinator",
  "main.controller.messageSentEffort": "effort {effort}",
  "main.controller.messageSentGoal": "goal {goal}",
  "main.controller.messageSentStudyUpdate": "update: {parts}",
  "main.controller.messageSentTeamUpdates": "team updates",
  "main.controller.messageSentPhase": "phase: {phase}",
  "main.controller.messageSentAutomaticMove": "automatic move: {move}",
  "main.controller.messageSentConfirmationReminder":
    "reminder: generic confirmation question",
  "main.controller.messageSentMissingButtonReminder":
    "reminder: a button that was not there",
  "main.controller.messageSentSkills": "skills: {skills}",
  "main.controller.noReplyTitle": "The Coordinator did not write a reply",
  "main.controller.commandActivityFallback": "Command",
  "main.controller.searchFoundNothing": "No results",
  "main.controller.commandExitCode": "Exit {code}",
  "main.controller.fileChangeTitle": "Changed {files} files",
  "main.controller.fileChangeTitle.one": "Changed {files} file",
  "main.controller.tramaToolTitle": "Trama tool: {tool}",
  "main.controller.reasoningTitle": "Reasoning",
  "main.controller.coordinatorNoteTitle": "Coordinator note",

  // Continuous work and delegated steps
  "main.controller.stepUnderstandingSummary":
    'Understanding of the request "{request}".',
  "main.controller.stepInChatSeams": "The Coordinator confirmed the test points of plan {plan}",
  "main.controller.stepInChatSlices": "The Coordinator approved the {count} slices of plan {plan}",
  "main.controller.stepInChatSlices.one": "The Coordinator approved the slice of plan {plan}",
  "main.controller.stepInChatCorrect": "The mandate lets it do so without asking you. To change something, write it here or correct the step in Activity.",
  "main.controller.stepSeamsSummary": "Test points of plan {plan}: {seams}.",
  "main.controller.stepSlicesSummary": "Slices of plan {plan}: {slices}.",
  "main.controller.stepStillWriting":
    "The Coordinator is still writing this step: correct it when it has finished.",
  "main.controller.stepCorrectedTitle": "{step}: corrected",
  "main.controller.slicesBackTitle":
    "The slices of plan {plan} go back into preparation",
  "main.controller.slicesBackDetail":
    "The issues already published ({issues}) stay on GitHub: the Coordinator updates or closes them.",
  "main.controller.roundFallbackSpecialist": "A specialist",
  "main.controller.roundWorksOnSlice": "{name} works on slice {slice}",
  "main.controller.roundWorksOnAssignment":
    "{name} works on assignment {assignment}",
  "main.controller.roundStartedMove": 'Started the move "{move}"',
  "main.controller.coordinatorPausedTitle": "Coordinator paused",
  "main.controller.coordinatorPausedDetail":
    "No automatic move, Round or automatic work starts until you resume the Coordinator.",
  "main.controller.coordinatorResumedTitle": "Coordinator resumed",
  "main.controller.stepNoLongerAvailable": "This step is no longer available.",
  "main.controller.queuedMessageGone":
    "The message has already left or is no longer in the queue.",
  "main.controller.queuedMessageNotRemovable":
    "This message tells the Coordinator about a choice already recorded: it leaves anyway.",
  "main.controller.goalDialogBusyTurn":
    "The Coordinator is replying on this goal: wait for the end of the turn.",
  "main.controller.goalDialogBusyQueue":
    "The goal has a queued message: wait for it to leave or delete it.",

  // Ask Trama routes
  "main.controller.routeNotFound": "Route {route} not found.",
  "main.controller.routeWaitTurn":
    "Wait for the end of the Coordinator's turn before answering the route.",
  "main.controller.routeBoundaryTitle": "{label} for route {route}",

  // MARK: Controller: goals, pact, team, candidates and learning
  // Goals
  "main.controller.goalCardTitle": "Goal",
  "main.controller.focusNotSavedUnreadable":
    "The focus was not saved: the project state is not readable and Trama does not overwrite it.",
  "main.controller.focusNotSaved": "The focus was not saved: {error}",
  "main.controller.goalNotSavedUnreadable":
    "The goal was not saved: the project state is not readable and Trama does not overwrite it.",
  "main.controller.goalNotSaved": "The goal was not saved: {error}",
  "main.controller.projectNotRecent":
    "The project is not among the recent ones.",
  // Pact and mandate
  "main.controller.decisionChangedStop":
    "Decision {decision} changed or is under review.",
  "main.controller.mandateCorrectedStop":
    "The corrected mandate no longer covers this work.",
  "main.controller.projectMandateCardTitle": "Project mandate",
  "main.controller.mandateRestrictedStop":
    "The narrowed mandate no longer covers this work. The working copy stays as it is.",
  "main.controller.mandateRevokedStop": "Mandate revoked: {reason}",
  // Team
  "main.controller.waitingForDeveloperTitle": "Waiting for a free developer",
  "main.controller.waitingForDeveloperDetail":
    "{count} developers are already at work in the open projects, the shared maximum. The assignment starts as soon as one is free, in the order of the projects in the Overview.",
  "main.controller.waitingForDeveloperDetail.one":
    "{count} developer is already at work in the open projects, the shared maximum. The assignment starts as soon as one is free, in the order of the projects in the Overview.",
  "main.controller.mandateNoLongerCoversAssignment":
    "The mandate no longer covers this assignment.",
  "main.controller.startSkippedTitle": "Start skipped",
  "main.controller.assignmentProviderNoAdapter": "{provider} has no adapter.",
  "main.controller.providerCannotWork": "{provider} cannot work now: {reason}",
  "main.controller.assignmentWaitingProviderTitle":
    "Assignment waiting for the provider",
  "main.controller.assignmentResumedTitle": "Assignment resumed",
  "main.controller.assignmentStartedTitle": "Assignment started",
  "main.controller.assignmentRunsInWorktree": "{model}, own working copy",
  "main.controller.assignmentRunsReadOnly": "{model}, read-only",
  "main.controller.worktreeReadyTitle": "Working copy ready",
  "main.controller.dependenciesUnavailableTitle": "Dependencies not available",
  "main.controller.stopBeforeStart": "The stop was requested before the start.",
  "main.controller.stopBeforeTurn":
    "The stop was requested before the turn started.",
  "main.controller.newSpecialistThreadTitle": "New specialist thread",
  "main.controller.specialistNoteTitle": "Developer note",
  "main.controller.specialistReasoningTitle": "Reasoning",
  "main.controller.specialistCommandTitle": "Command",
  "main.controller.specialistCommandExit": "Exit {code}",
  "main.controller.specialistEditedFiles": "Edited {count} files",
  "main.controller.specialistEditedFiles.one": "Edited a file",
  "main.controller.specialistEditFailed": "File edit failed",
  "main.controller.specialistNoReport": "The specialist wrote no report.",
  "main.controller.turnNotStarted": "The turn had not started.",
  "main.controller.decisionCardTitle": "Decision",
  "main.controller.assignmentCompletedTitle": "Assignment completed",
  "main.controller.stopConfirmedTitle": "Stop confirmed",
  "main.controller.pausedForQuestionTitle": "Paused for a question",
  "main.controller.assignmentFailedTitle": "Assignment failed",
  "main.controller.waitingProviderUnblockTitle":
    "Waiting for {provider} to unblock",
  "main.controller.waitingProviderUnblockDetail":
    "{reason} Trama resumes the assignment by itself when the provider is available again, if the mandate still covers it.",
  "main.controller.providerBlockedNotificationTitle":
    "Trama: {provider} blocked",
  "main.controller.providerBlockedNotificationBody":
    "The work of {specialist} in {project} waits for {provider} to unblock.",
  "main.controller.exampleProjectName": "Example project",
  "main.controller.waitingTemporaryLimitTitle":
    "Waiting for the temporary limit of {provider} to pass",
  "main.controller.waitingTemporaryLimitDetail":
    "It is not the account quota. Trama resumes the assignment by itself in {seconds} seconds, if the mandate still covers it.",
  "main.controller.operatorRan": "{agent} ran a command: {command}",
  "main.controller.operatorFailed": "{agent} ran a command that did not go well: {command}",
  "main.controller.operatorWaiting": "{agent} waits for your yes on a command that cannot be undone: {command}",
  "main.controller.operatorOutput": "Result of {agent}'s command",
  "main.controller.operatorDeclined": "You said no: {agent}'s command does not run. {command}",
  "main.controller.operatorOpened": "{agent} opened {site} in your Chrome",
  "main.controller.operatorSent": "{agent} sent data to {site}",
  "main.controller.operatorSendFailed": "{agent} tried to send data to {site}, but the send did not go through",
  "main.controller.operatorSendWaiting": "{agent} waits for your yes on a send that cannot be undone: {site}",
  "main.controller.operatorNeedsLogin": "{agent} stopped on {site}: you are not signed in. Sign in on the site in Chrome, then ask again. No agent types a password.",
  "main.controller.siteConsentAsked": "{agent} waits for your consent to open {site}",
  "main.controller.siteConsentFromPhrase": "Consent recorded for {site}, from your sentence \"{phrase}\"",
  "main.controller.siteConsentFromButton": "Consent recorded for {site}, from your yes in Aspetta te",
  "main.controller.siteConsentBlocked": "I do not record a consent for {site}: it is on the blocked sites and no agent opens it, with or without a consent.",
  "main.controller.siteConsentAlready": "The consent for {site} is already there in this project.",
  "main.controller.siteConsentNotRecorded": "I did not record the consent for {site}.",
  "main.controller.siteConsentWithdrawnFromPhrase": "Consent withdrawn for {site}, from your sentence \"{phrase}\"",
  "main.controller.siteConsentWithdrawn": "Consent withdrawn for {site}",
  "main.controller.siteConsentDeclined": "You said no: {agent} does not open {site}.",
  "main.controller.siteConsentNotFound": "This consent is gone.",
  "main.controller.siteConsentRequestNotFound": "This request no longer waits for your yes.",
  "main.controller.appConsentAsked": "{agent} waits for your consent to use the screen in {app}",
  "main.controller.appConsentFromPhrase": "Consent recorded for the app {app}, from your sentence \"{phrase}\"",
  "main.controller.appConsentFromButton": "Consent recorded for the app {app}, from your yes in Aspetta te",
  "main.controller.appConsentAlready": "The consent for the app {app} is already in this project.",
  "main.controller.appConsentNotRecorded": "I did not record the consent for the app {app}.",
  "main.controller.tramaControlStopped": "{agent} did not run «{command}»: it reached Trama itself (its window, its data, its installation or its process). It is a fixed ban: there is nothing to approve.",
  "main.controller.nothingWaitingTitle": "Nothing to approve in Waiting for you",
  "main.controller.nothingWaitingDetail": "The Coordinator sends you to Waiting for you, but nothing is there now: the request it mentions was not created. There is nothing for you to approve.",
  "main.controller.appConsentProtected": "I did not record a consent for {app}: Trama never lets an agent use the screen in this app.",
  "main.controller.screenProtected.trama": "{agent} does not use the screen in {app}: it is Trama's own window and no agent controls it. There is nothing to approve.",
  "main.controller.screenProtected.system": "{agent} does not use the screen in {app}: system settings and the windows that grant permissions are yours alone. There is nothing to approve.",
  "main.controller.screenProtected.commands": "{agent} does not use the screen in {app}: what is typed there runs as a command, outside Trama's checks. Commands go through Trama. There is nothing to approve.",
  "main.controller.screenProtected.passwords": "{agent} does not use the screen in {app}: it is a password manager and no agent controls it. There is nothing to approve.",
  "main.controller.appConsentWithdrawnFromPhrase": "Consent withdrawn for the app {app}, from your sentence \"{phrase}\"",
  "main.controller.appConsentWithdrawn": "Consent withdrawn for the app {app}",
  "main.controller.appConsentDeclined": "You said no: {agent} does not use the screen in {app}.",
  "main.controller.screenPermission.accessibility": "Accessibility",
  "main.controller.screenPermission.screenRecording": "Screen Recording",
  "main.controller.screenPermissionMissing": "{agent} cannot use the screen. Missing macOS permissions: {permissions}. Grant them yourself in System Settings, Privacy & Security: Trama does not change system settings. Then ask to try again.",
  "main.controller.screenPasswordField": "{agent} stopped in {app}: the focused field is a password. No agent types a password, you do.",
  "main.controller.commandApprovalNotFound": "This command no longer waits for your yes.",
  "main.controller.dependenciesInstalledTitle": "Packages installed by Trama",
  "main.controller.dependenciesInstalledDetail": "Trama installed the project's {count} packages in the worktree, without running their install scripts.",
  "main.controller.baseAlignedTitle": "{target} brought into the working copy",
  "main.controller.baseAlignFailedTitle": "Realignment with the base failed",
  "main.controller.baseAlignFailed.merge_in_progress": "A merge is already in progress in the working copy: the developer has to resolve it. Files in conflict: {detail}.",
  "main.controller.baseAlignFailed.unreadable_base": "Trama cannot read the base branch in the working copy ({detail}).",
  "main.controller.baseAlignFailed.merge_failed": "The merge did not start and the work in the copy is as it was. Git says: {detail}",
  "main.controller.baseAlignFailed.ignored_files": "The merge would overwrite ignored files of the copy that git does not save: {detail}. Nothing changed: the developer moves them out of the copy and tries again.",
  "main.controller.baseAligned.conflicts": "The merge waits for the Coordinator's commit. Files in conflict: {files}.",
  "main.controller.baseAligned.merged": "The merge has no conflicts and waits for the Coordinator's commit.",
  "main.controller.baseAligned.upToDate": "The working copy already has the whole base branch.",
  "main.controller.baseAligned.savedWork": "The work that was not saved yet was put in a commit of Trama's before the merge.",
  "main.controller.baseAligned.fetchError": "The base branch could not be fetched ({error}): Trama used the last known copy.",
  "main.controller.dependenciesFailedTitle": "Package install failed",
  "main.controller.developerQuestionTitle":
    "Question {question} to the Coordinator",
  "main.controller.answerReceivedTitle": "Answer received",
  "main.controller.answerReceivedDetail":
    "Trama resumes the work with the answer.",
  "main.controller.projectStateReadOnly":
    "The state of this project is read-only.",
  "main.controller.exampleProjectDutiesStill":
    "In the example project the automatic work stays still.",
  "main.controller.projectChangedDutyNotStarted":
    "The project changed: the automatic work did not start.",
  "main.controller.problemIssuesUnreadable":
    "GitHub CLI did not read the issues: {error}",
  "main.controller.problemIssueNotOpened": "The issue was not opened: {error}",
  "main.controller.selfPickTitle":
    "{developer} takes slice {slice} on their own",
  "main.controller.worktreeConflictNotificationTitle":
    "Trama: conflict between two working copies",
  "main.controller.worktreeConflictNotificationBody":
    "Candidate {candidate} conflicts with {other}: it gets resolved before the merge.",
  "main.controller.parallelDevelopersNotInteger":
    "The number of developers in parallel must be a whole number.",
  "main.controller.developersPerSquadNotInteger": "The number of developers per squad must be a whole number.",
  "main.controller.activeSquadsNotInteger": "The number of squads at work together must be a whole number.",
  "main.controller.noTurnRunning": "No turn in progress.",
  "main.controller.noSessionToReorder": "The Coordinator does not have a session to reorder yet.",
  "main.controller.cloudStopUntracked":
    "Trama no longer follows the cloud session. Stop the session from its Claude Code page.",
  "main.controller.personActor": "Person",
  "main.controller.stoppedByGoalPutAway": "Stopped: you put its goal away.",
  "main.controller.stoppedByPause": "Stopped by the Pause: it starts again when you resume.",
  "main.controller.stoppedByPerson": "Stopped by the person",
  "main.controller.noWorktreeToRemove":
    "The assignment has no working copy to remove.",
  "main.controller.stopBeforeRemovingWorktree":
    "Stop the assignment before removing the working copy.",
  "main.controller.worktreeInUse":
    "Another assignment is working in this working copy: wait for it to finish.",
  "main.controller.worktreeRemovedTitle": "Working copy removed",
  "main.controller.mergeConcludedTitle": "Merge recorded in the working copy {branch}",
  "main.controller.worktreeRemovedBranchDeleted":
    "Branch {branch} was deleted too: it had no commits.",
  "main.controller.worktreeRemovedBranchKept": "Branch {branch} stays.",
  "main.controller.modelNotInCatalog":
    "Model {model} is not in the catalog of {provider}.",
  "main.controller.specialistModelSetTitle": "Model of {name} chosen by the person",
  "main.controller.specialistModelSetDetail": "{provider} {model}. It applies to the next assignments; the work in progress does not change.",
  "main.controller.specialistModelSetDetailEffort":
    "{provider} {model}, effort {effort}. It applies to the next assignments; the work in progress does not change.",
  "main.controller.specialistModelClearedTitle": "Model of {name} chosen by the Coordinator again",
  "main.controller.specialistModelClearedDetail": "For the next assignments the Coordinator chooses provider and model.",
  "main.controller.assignmentProviderChangedTitle":
    "Assignment provider changed",
  "main.controller.assignmentProviderChangedDetail":
    "{provider} {model}. The assignment and the working copy stay; the next resume opens a new session.",
  "main.controller.currentMandateNoLongerCovers":
    "The current mandate no longer covers this assignment.",
  "main.controller.assignmentWorktreeRemoved":
    "The working copy of this assignment was removed: give a new assignment.",
  "main.controller.assignmentRedelegatedTitle":
    "Assignment delegated again on the current decisions",
  "main.controller.developerRenamedTitle": "Developer renamed",
  "main.controller.developerRenamedDetail":
    "{previous} is now called {name} ({id}).",
  "main.controller.dependsOnStop": "Depends on {assignment}. {reason}",
  // Checks and candidates
  "main.controller.checkoutCheckPassed": "Check {check}: passed",
  "main.controller.checkoutCheckFailed": "Check {check}: failed",
  "main.controller.candidateCheckEnvironment":
    "Check {check} on {candidate}: failed because of the sandbox or the machine, the evidence stays as it was",
  "main.controller.candidateCheckPassed":
    "Check {check} on {candidate}: passed",
  "main.controller.candidateCheckFailed":
    "Check {check} on {candidate}: failed",
  "main.controller.gateReviewersTitle":
    "Reviewers on candidate {candidate}: {status}",
  "main.controller.reviewUnreadableVerdict":
    "The technical review returned no readable verdict.",
  "main.controller.tramaQuitting": "Trama is closing.",
  "main.controller.noReadOnlyModelForReviewers":
    "No read-only model available for the reviewers of the candidate.",
  "main.controller.sliceNoteTitle": "Note for this slice: {reviewer} has a finding on candidate {candidate} about this assignment's files",
  "main.controller.blockingFindingsTitle":
    "{reviewer} to {developer}: {count} blocking findings on candidate {candidate}",
  "main.controller.blockingFindingsTitle.one":
    "{reviewer} to {developer}: {count} blocking finding on candidate {candidate}",
  "main.controller.findingsWaitAssignmentGone":
    "The assignment is gone: a new assignment is needed.",
  "main.controller.findingsWaitProjectClosed":
    "The project is not open: the work resumes when you open it again.",
  "main.controller.findingsWaitPaused": "The Coordinator is paused: the work resumes when you press Resume.",
  "main.controller.findingsWaitMandate":
    "The current mandate no longer covers this assignment: the work resumes when you grant it again.",
  // Focus mode and publication
  "main.controller.candidateNotFound": "Candidate not found.",
  "main.controller.focusNoWorktree":
    "The candidate no longer has its working copy: deep review cannot read it.",
  "main.controller.focusWorktreeChanged":
    "The working copy changed after candidate {candidate} was declared: deep review examines only the declared candidate.",
  "main.controller.noReadOnlyModelForAxes":
    "No read-only model available for the code-review axes.",
  "main.controller.confirmationFailed":
    "The confirmation by {model} failed: {error}",
  "main.controller.commitMessageRefused":
    "Trama does not write this commit message: {problems} Ask the Coordinator to fix it.",
  "main.controller.candidateSuperseded":
    "The candidate was replaced by newer work: publish the new one.",
  "main.controller.candidateNotVerified":
    "The candidate is not verified: {blockers}.",
  "main.controller.candidateNeedsApproval":
    "Review and approve the candidate before publishing it.",
  "main.controller.candidateAlreadyPublished":
    "The candidate is already published: {url}",
  "main.controller.candidatePublishedMessage":
    "I published candidate {candidate} as pull request #{number}: {url}",
  "main.controller.projectNoGitHubRemote": "The project has no GitHub remote.",
  "main.controller.candidateBranchFallback": "candidate branch",
  "main.controller.publicationStandardMissing":
    "The candidate does not meet the publication standard: {missing}",
  "main.controller.gitHubUnreachable": "GitHub is not reachable.",
  "main.controller.gitHubNoPushPermission":
    "Your GitHub account has no push permission on {repository}.",
  "main.controller.pullRequestPublishedTitle":
    "Pull request #{number} published",
  // Merge
  "main.controller.mergeInterrupted":
    "The merge was interrupted: Trama tries again.",
  "main.controller.mergeUnknownHead":
    "Trama does not know the commit published in pull request #{number}: merge it on GitHub after looking at it.",
  "main.controller.mergeCandidateChanged":
    "The candidate changed after the green light: it needs a new green light as it is now.",
  "main.controller.mergeWaitingChecks":
    "Waiting for the checks of pull request #{number}.",
  "main.controller.mergeChecksRed":
    "The checks of pull request #{number} on GitHub are red: the Coordinator fixes them before the merge.",
  "main.controller.mergeCommitByCoordinator":
    "Green light from the Coordinator on candidate {candidate}, merged by Trama.",
  "main.controller.mergeCommitByPerson":
    "The person's ok on the screenshots of candidate {candidate}, merged by Trama.",
  "main.controller.shotNotFound": "Screenshot not found.",
  "main.controller.shotOutsideFolder": "Screenshot outside Trama's folder.",
  "main.controller.candidateRejectedTitle": "Candidate {candidate} rejected",
  "main.controller.rejectionAssignmentGone": "The assignment is gone.",
  "main.controller.candidateRejectedMessage":
    "I rejected candidate {candidate} by {developer}: {reason}\nThe work does not resume by itself ({waiting}): have it fixed with a new assignment.",
  "main.controller.candidateRejectedMessageNoDeveloper":
    "I rejected candidate {candidate}: {reason}\nThe work does not resume by itself ({waiting}): have it fixed with a new assignment.",
  // Tickets and monitor
  "main.controller.monitorNotificationTitle": "Trama: shared updates",
  "main.controller.monitorNotificationBody":
    "{count} updates on {repository}. Open Trama to see how they affect your work.",
  "main.controller.monitorNotificationBody.one":
    "One update on {repository}. Open Trama to see how it affects your work.",
  "main.controller.invalidRepository": "Invalid repository.",
  // Plans and slices
  "main.controller.planCardTitle": "Plan",
  "main.controller.planCancelledByPerson": "Cancelled by the person.",
  "main.controller.planNoSpecToCorrect": "The plan has no spec to correct yet.",
  "main.controller.specCorrectedTitle": "Spec of plan {plan} corrected",
  "main.controller.planNoProposalToCorrect":
    "The plan has no proposal to correct yet.",
  "main.controller.planCorrectionIncomplete":
    "A corrected plan has at least one step and one behavior.",
  "main.controller.planCorrectedTitle": "Plan {plan} corrected",
  "main.controller.planNotWaitingSeams":
    "The plan is not waiting for an answer on the test points.",
  "main.controller.seamsCorrectionEmpty":
    "Write what to change in the test points.",
  "main.controller.seamsConfirmedTitle": "Test points of plan {plan} confirmed",
  "main.controller.seamsCorrectedTitle": "Test points of plan {plan} corrected",
  "main.controller.planNoSpecToPublish":
    "The plan has no spec ready to publish.",
  "main.controller.specStaysInTrama":
    "GitHub is not connected: the spec stays in Trama.",
  "main.controller.specNotPublished":
    "The spec was not published on GitHub: {error}",
  "main.controller.specPublishedTitle":
    "Spec of plan {plan} published as issue #{issue}",
  "main.controller.gitHubNotConnected": "GitHub is not connected.",
  "main.controller.specIssueNotUpdated":
    "Issue #{issue} did not take the correction: {error}",
  "main.controller.noModelForPlanner": "No model available for the planner.",
  "main.controller.repositoryChangedDuringPlan":
    "The repository changed during the analysis: reassess the plan or ask for a new one.",
  "main.controller.planNotWaitingSlices":
    "The plan is not waiting for an answer on the slices.",
  "main.controller.slicesCorrectionEmpty":
    "Write what to change in the slices.",
  "main.controller.slicesConfirmedTitle": "Slices of plan {plan} confirmed",
  "main.controller.slicesCorrectedTitle": "Slices of plan {plan} corrected",
  "main.controller.planNoSpecToSlice":
    "The plan has no spec ready to split into slices.",
  "main.controller.slicesAlreadyInProgress":
    "The slices of the plan are already being prepared or proposed.",
  "main.controller.sliceBlockedInTextOnly":
    "#{issue} blocked by {blocker} only in the text: {error}",
  "main.controller.sliceNotPublished":
    "Slice {slice} was not published: {error}",
  "main.controller.slicesPublishedTitle":
    "Slices of plan {plan} published as issues",
  "main.controller.planNoApprovedSlices":
    "The plan has no approved slices to publish.",
  "main.controller.slicesStayInTrama":
    "GitHub is not connected: the slices stay in Trama.",
  "main.controller.noModelForSlicer":
    "No model available to split the work into slices.",
  // Example project and working method
  "main.controller.pactDemoOnlyExample":
    "The scenario works only in the example project.",
  "main.controller.pactDemoApprover": "Local Trama user, simulation",
  "main.controller.aiHeroUpdatedTitle":
    "AI Hero working method updated from {version}: {count} files",
  "main.controller.aiHeroUpdatedTitle.one":
    "AI Hero working method updated from {version}: {count} file",
  "main.controller.aiHeroPreparedTitle":
    "AI Hero working method: {count} files created",
  "main.controller.aiHeroPreparedTitle.one":
    "AI Hero working method: {count} file created",
  "main.controller.aiHeroRollbackTitle": "AI Hero method update undone",
  "main.controller.aiHeroRollbackKept":
    "Changed by you after the update, not restored: {path}",
  "main.controller.unknownExercise": "Unknown exercise.",
  "main.controller.conflictExerciseOnlyExample":
    "The conflict exercise works only in the example project.",
  "main.controller.conflictExerciseNeedsCandidate":
    "It needs an unpublished candidate in a working copy: complete the change exercise first.",
  "main.controller.conflictExerciseDone":
    "The exercise comparison was already done on candidate {candidate}.",
  "main.controller.conflictExerciseTitle": "Conflict exercise",
  "main.controller.conflictExerciseDetail":
    "Trama creates two simulated changes in a separate local copy and compares them with candidate {candidate}. There is no real collaborator and no network is used.",
  // Learning
  "main.controller.learningReviewFailedTitle": "The experience review failed",
  "main.controller.learningReviewTitle": "Experience review",
  "main.controller.learningReviewDetail":
    "{actions}\nYou find it in Memory: you can correct or withdraw what was learned.",
  "main.controller.skillPinned":
    "'{name}' is pinned: unpin it before archiving it.",
  "main.controller.skillMissing": "Skill {name} no longer exists.",
  // Settings
  "main.controller.languageUnavailable": "Language not available.",
  "main.controller.sharedDevelopersNotInteger":
    "The number of shared developers must be a whole number.",

  // MARK: Fixed roles and work phases (duties.ts, workPhase.ts)
  "main.duties.droppedClosed": "was closed",
  "main.duties.droppedTriageState": "already has the triage state `{role}`",
  "main.duties.droppedInAssignment": "is already in work in assignment {id}",
  "main.duties.droppedInPlan": "is already in work in plan {id}",
  "main.duties.droppedPullRequest": "has the linked pull request #{number}",
  "main.duties.unknownCommit": "unknown",
  "main.duties.triageObjective": "Triage of issue #{number}: {title}",
  "main.duties.placeCandidate": "candidate {id}",
  "main.duties.placeCheckout": "checkout at commit {commit}",
  "main.duties.diagnosisObjective":
    "Diagnosis: the {check} check fails on the {place}",
  "main.duties.diagnosisObjectiveRegression":
    "Diagnosis: the {check} check fails on the {place}, and it passed before",
  "main.duties.fixObjective":
    "Fix with a regression test: the {check} check on the {place}",
  "main.duties.reviewObjective": "Architecture review at commit {commit}",
  "main.duties.domainObjective": "Glossary and ADRs from decisions {decisions}",
  "main.duties.fixNoModules":
    "The diagnosis names no project modules: the Coordinator assigns the fix.",
  "main.duties.fixWorkingCopyGone":
    "The candidate's working copy is gone: the Coordinator assigns the fix.",
  "main.duties.fixNotCovered":
    "The mandate does not cover the fix on {modules}: it starts when the mandate allows it.",
  "main.duties.fixWaitsForWork":
    "The fix waits for the work in progress on {modules} to finish.",
  "main.duties.fixRoleBusy": "The fix waits: bug triage cannot take it now.",
  "main.duties.reviewCleanCodeBusy":
    "Clean Code is working on assignment {id}: the review waits for it to finish.",
  "main.duties.reviewAlreadyDone":
    "Clean Code already reviewed commit {commit}: it proposes again after the next code changes.",
  "main.duties.reviewCardOpen":
    "Waits for your answer to card {card} with the proposals of the previous review.",
  "main.duties.reviewNoChangeSinceLast":
    "No work changed the code since the last review: it starts when the team finishes work that changes the code and is free.",
  "main.duties.reviewNoChangeYet":
    "No team work has changed the code yet: it starts when the team finishes work that changes the code and is free.",
  "main.duties.reviewHeadUnknown":
    "Trama cannot read the checkout's commit: the review starts when it can.",
  "main.duties.reviewTeamBusy":
    "Waits for the team to be free: {count} assignments are at work.",
  "main.duties.reviewTeamBusy.one":
    "Waits for the team to be free: one assignment is at work.",
  "main.duties.reviewCoordinatorBusy":
    "Waits for the Coordinator to finish the current turn.",
  "main.duties.reviewDue":
    "Starts now: the team is free and changed the code since the last review (commit {commit}).",
  "main.duties.requestMandateMissing":
    "Without a granted mandate Trama does not start the fixed roles' automatic work.",
  "main.duties.requestProviderUnavailable":
    "No connected provider can run the fixed roles' work now.",
  "main.duties.requestRoleBusy":
    "{role} is already working on assignment {id}: try again when it finishes.",
  "main.duties.requestCardOpen":
    "Card {card} with the proposals of the previous review still waits for your answer.",
  "main.duties.requestHeadUnknown":
    "Trama cannot read the checkout's commit: the review cannot start.",
  "main.duties.requestGitHubUnavailable":
    "Trama cannot read the GitHub issues: triage cannot start.",
  "main.duties.requestIssueNotFound":
    "Issue #{number} is not among those Trama reads on GitHub.",
  "main.duties.requestIssueClosed":
    "Issue #{number} is closed: triage covers open issues.",
  "main.duties.runnerMissing":
    "No connected provider can run it now: it starts when the Coordinator's provider is available.",
  "main.duties.mandateMissing":
    "Without a granted mandate it stays still: it starts when you grant a mandate.",
  "main.duties.triageNoGitHub":
    "Trama cannot read the GitHub issues: triage starts when it can.",
  "main.duties.triageNothingNew":
    "No new issue to triage: it starts when an issue is opened after Trama started following the project, not yet in work and with no linked pull request.",
  "main.duties.triageLastDropped":
    "Last one left out: #{number}, which {reason}.",
  "main.duties.triageOthers": " (and {count} more after it)",
  "main.duties.triageWaitsRole":
    "Issue #{number}{others} waits for bug triage to finish assignment {id}.",
  "main.duties.triageWaitsDiagnosis":
    "Issue #{number}{others} waits for the diagnosis of a failed check, which comes first.",
  "main.duties.triageDue": "Starts now on issue #{number}{others}.",
  "main.duties.diagnosisNothing":
    "No failed check to diagnose: it starts when a test or a Trama check fails.",
  "main.duties.diagnosisWaitsRole":
    "The {check} check waits for bug triage to finish assignment {id}.",
  "main.duties.diagnosisDue": "Starts now on the failed {check} check.",
  "main.duties.domainNothing":
    "No glossary or ADR proposal to write: it starts when the Coordinator draws one from your decisions.",
  "main.duties.domainNotAllowed":
    "The mandate does not allow writing proposal {id}: it waits for a change to the mandate.",
  "main.duties.domainNotAllowedOn":
    "The mandate does not allow writing proposal {id} on {modules}: it waits for a change to the mandate.",
  "main.duties.domainNoMandate": "Proposal {id} waits for a mandate.",
  "main.duties.domainWaitsRole":
    "Proposal {id} waits for the documentation and domain role to finish assignment {assignment}.",
  "main.duties.domainWaitsWork":
    "Writing proposal {id} waits for the work in progress on {modules} to finish (assignment {assignment}).",
  "main.duties.domainWaitsRunner": "Proposal {id} waits.",
  "main.duties.domainDue": "Writing proposal {id} starts now.",
  "main.duties.running": "In progress in assignment {id}: {objective}.",
  "main.duties.writingNoMandate":
    "Without a valid mandate nobody writes the files: the proposal waits for the mandate.",
  "main.duties.writingNotAllowed":
    "The mandate does not allow work in a working copy: the proposal waits for a change to the mandate.",
  "main.duties.writingNotAllowedOn":
    "The mandate does not allow work in a working copy on {modules}: the proposal waits for a change to the mandate.",
  "main.duties.writingNoRunner":
    "No provider can run the documentation and domain role's work now.",
  "main.duties.writingRoleBusy":
    "The documentation and domain role is busy: it writes the proposal as soon as it is free.",
  "main.duties.writingWaitsWork":
    "The writing waits for the work in progress on {modules} to finish.",
  "main.duties.writingRoleUnavailable":
    "The writing waits: the documentation and domain role cannot take it now.",
  "main.duties.modelLight":
    "Chosen by Trama: the lightest model in the catalog, for the fixed roles' automatic work.",
  "main.duties.modelFallback":
    "Chosen by Trama: the catalog has no recognizable light model, so it uses the Coordinator's.",
  "main.duties.triageResultTitle":
    "**Triage of issue #{number}: {category}, `{state}` ({stateLabel}).**",
  "main.duties.headingVerification": "### Verification",
  "main.duties.headingAlreadyImplemented": "### Already in the code",
  "main.duties.headingProposedComment": "### Proposed comment for the issue",
  "main.duties.triageOpenedByCoordinator":
    "The Coordinator opened this issue for a problem it found: Trama applies the triage labels to it. The comment is your choice.",
  "main.duties.triageNothingPublished":
    "Trama publishes nothing on GitHub: labels and comment are your choice.",
  "main.duties.diagnosisReproducedTitle":
    "**Bug reproduced: the feedback loop goes red.**",
  "main.duties.diagnosisNotReproducedTitle":
    "**Bug not reproduced: no feedback loop goes red.**",
  "main.duties.headingLoop": "### Feedback loop",
  "main.duties.headingSeams": "### Test points",
  "main.duties.headingHypotheses": "### Hypotheses",
  "main.duties.headingCause": "### Cause",
  "main.duties.headingRegressionTest": "### Regression test",
  "main.duties.headingFix": "### Fix",
  "main.duties.headingOpenQuestions": "### What is needed",
  "main.duties.architectureNothing":
    "**Nothing to report**: Clean Code found no opportunities to deepen.",
  "main.duties.architectureProposals": "**{count} proposals from Clean Code.**",
  "main.duties.architectureProposals.one": "**One proposal from Clean Code.**",
  "main.duties.proposalFiles": "Files: {files}",
  "main.duties.proposalFilesNotGiven": "not given",
  "main.duties.proposalProblem": "Problem: {text}",
  "main.duties.proposalSolution": "Solution: {text}",
  "main.duties.proposalBenefits": "Benefits: {text}",
  "main.duties.cardQuestion":
    "Which architecture improvement do you want to explore?",
  "main.duties.cardReviewed":
    "Clean Code reviewed the project at commit {commit} (assignment {id}).",
  "main.duties.cardAdvice": "Advice: {text}",
  "main.duties.cardOtherProposals":
    "The other {count} proposals are in the assignment's result.",
  "main.duties.cardFilesNotGiven": "Files not given",
  "main.duties.cardWarning": "Warning: {text}",
  "main.duties.cardNoneForNow": "None for now",
  "main.duties.cardNoneExample":
    "The code stays as it is; Clean Code proposes again after the next changes.",
  "main.duties.triageLine": "Triage of issue #{number}: {category}, {state}",
  "main.duties.diagnosisLineReproduced": "Diagnosis: bug reproduced.",
  "main.duties.diagnosisLineNotReproduced": "Diagnosis: bug not reproduced",
  "main.duties.architectureLineProposals":
    "Architecture review: {count} proposals to decide",
  "main.duties.architectureLineProposals.one":
    "Architecture review: one proposal to decide",
  "main.duties.architectureLineNothing":
    "Architecture review: nothing to report",

  "main.workPhase.phaseClarification": "clarification",
  "main.workPhase.phaseSpec": "spec",
  "main.workPhase.phaseSlices": "slices",
  "main.workPhase.phaseExecution": "execution",
  "main.workPhase.phaseVerification": "verification",
  "main.workPhase.phaseCandidate": "candidate",
  "main.workPhase.phaseMerged": "merged",
  "main.workPhase.phaseBlocked": "blocked",
  "main.workPhase.answerQuestions": "Answer the question",
  "main.workPhase.answerQuestionsMany": "Answer the {count} questions",
  "main.workPhase.confirmUnderstanding": "Confirm the understanding",
  "main.workPhase.confirmUnderstandingMessage":
    "I confirm the shared understanding: go ahead.",
  "main.workPhase.grantMandate": "Grant the mandate",
  "main.workPhase.confirmTeam": "Confirm the team",
  "main.workPhase.confirmSeams": "Confirm the test points",
  "main.workPhase.confirmSlices": "Confirm the slices",
  "main.workPhase.reviewPlan": "Review the plan",
  "main.workPhase.reviewCandidate": "Check the candidate",
  "main.workPhase.mergePullRequest": "Merge the pull request",
  "main.workPhase.preparePlan": "Prepare the plan",
  "main.workPhase.preparePlanMessage": "Prepare the plan.",
  "main.workPhase.assignWork": "Assign the work",
  "main.workPhase.assignWorkMessage": "Assign the work.",
  "main.workPhase.verifyCandidate": "Run the checks",
  "main.workPhase.verifyCandidateMessage": "Run the checks of the work.",
  "main.workPhase.answerQuestion": "Answer the developer",
  "main.workPhase.answerQuestionMessage": "Answer the developer's question.",
  "main.workPhase.clearCandidate": "Give the green light",
  "main.workPhase.clearCandidateMessage":
    "The candidate passed its gate: give the green light with clear_candidate, so Trama takes it to the merge.",
  "main.workPhase.settleReview": "Decide between the developer and the reviewers",
  "main.workPhase.settleReviewMessage":
    "The review stopped the same work again: read the reviewers' findings and the developer's answer, decide with settle_review, then carry the work on.",
  "main.workPhase.blockCheckFailed": "Fix the red check",
  "main.workPhase.blockWorktreeConflict": "Resolve the conflict",
  "main.workPhase.blockStalledAssignment": "Resume the stalled assignment",
  "main.workPhase.blockReviewLoop": "Decide between the developer and the reviewers",
  "main.workPhase.blockCheckFailedPhrase": "Fixing the red check",
  "main.workPhase.blockWorktreeConflictPhrase": "Resolving the conflict",
  "main.workPhase.blockStalledAssignmentPhrase":
    "Resuming the stalled assignment",
  "main.workPhase.blockReviewLoopPhrase": "I am deciding between the developer and the reviewers",
  "main.workPhase.workOfOnSlice": "{name}'s work on {slice}",
  "main.workPhase.workOf": "{name}'s work",
  "main.workPhase.workOnSlice": "the work on {slice}",
  "main.workPhase.work": "the work",
  "main.workPhase.whyCheckFailed": "A check of {work} did not pass.",
  "main.workPhase.whyDecisionChanged":
    "A Pact decision changed after {work}: it needs another look.",
  "main.workPhase.whyUnresolvedChoice": "{work} leaves a choice open.",
  "main.workPhase.whyExternalEffect":
    "{work} has an external effect that Trama cannot check.",
  "main.workPhase.whyRemoteConflict":
    "{work} conflicts with the main branch on GitHub: they need to be realigned.",
  "main.workPhase.whyPullRequestConflict":
    "The pull request of {work} conflicts with its base on GitHub: it needs realigning and publishing again.",
  "main.workPhase.whyWorktreeConflict":
    "{work} touches the same files as other work in progress.",
  "main.workPhase.whySemanticConflict":
    "{work} does not work together with other work in progress: a check fails on the two changes merged.",
  "main.workPhase.whyCloudCheckFailed":
    "{work} comes from the cloud and did not pass the checks on the Mac.",
  "main.workPhase.whyNotMergeable": "{work} cannot be merged yet.",
  "main.workPhase.whyPlanFailed":
    "The plan did not succeed: it needs to be redone.",
  "main.workPhase.whyPlanStale":
    "The repository changed while the plan was being written: it needs to be redone.",
  "main.workPhase.whySlicingFailed":
    "Splitting the plan into slices did not succeed: it needs another look.",
  "main.workPhase.whyProvider":
    "{work} waits for {provider} to be available again.",
  "main.workPhase.whyFailed": "{work} did not succeed.",
  "main.workPhase.whyStopped": "{work} was stopped.",
  "main.workPhase.whyReviewChanges":
    "The technical review asks for changes to {work}.",
  "main.workPhase.whyPaused":
    "{work} is paused: it waits for your answer to a question.",
  "main.workPhase.blockerCheckFailed":
    "The {check} check of candidate {id} did not pass.",
  "main.workPhase.blockerDecisionChanged":
    "Decision {decision} changed after candidate {id}.",
  "main.workPhase.blockerGate":
    "The reviewers have a blocking finding on candidate {id}: {detail}",
  "main.workPhase.blockerUnresolvedChoice":
    "Candidate {id} leaves a choice open: {detail}",
  "main.workPhase.blockerExternalEffect":
    "Candidate {id} has an external effect that Trama does not check: {detail}",
  "main.workPhase.blockerRemoteConflict":
    "Candidate {id} conflicts with the work on GitHub: {detail}",
  "main.workPhase.blockerChecksRed": "The checks of pull request #{number} of candidate {id} are red.",
  "main.workPhase.whyChecksRed": "{work} has red checks on GitHub: it goes back to the developer to fix them, then Trama merges it.",
  "main.workPhase.blockerPullRequestConflict":
    "GitHub finds conflicts between pull request #{number} of candidate {id} and its base: the merge is stopped and is not the person's to do. Realign the candidate's branch with the base in the same working copy: a correction to the same developer (replaces) that merges the updated base and resolves the conflicts. Then the new candidate goes through checks and reviewers and Trama publishes it again on the same pull request.",
  "main.workPhase.blockerWorktreeConflict":
    "Candidate {id} conflicts with the work of another assignment: {detail}",
  "main.workPhase.blockerDisputed": "After the findings on candidate {candidate}, the developer of assignment {assignment} ended without changing the working copy: they disagree with the reviewers. Another round of the reviewers on the same content would give the same findings: decide now with settle_review, or overrule with overrule_finding the findings that go against the Pact. Do not declare the candidate again and do not assign the same work again.",
  "main.workPhase.blockerHeld": "The review stopped the work of assignment {assignment} {rounds} times in a row, the last time on candidate {candidate}. Trama no longer sends it back to the developer and does not restart the reviewers: you decide with settle_review. With the reviewers, the developer resumes with the findings as your decision; with the developer, the findings are overruled and the work goes on to the merge. Write the reason and the doubt, do not ask the person and do not assign the same work again.",
  "main.workPhase.blockerSemanticConflict":
    "Candidate {id} does not work together with the work of another assignment: {detail}",
  "main.workPhase.blockerCloudCheckFailed":
    "Candidate {id} comes from a cloud session and did not pass the checks on the Mac: {detail}",
  "main.workPhase.blockerOther":
    "Candidate {id} is blocked: {reason}. {detail}",
  "main.workPhase.blockerPlanFailed": "Plan {id} did not succeed.",
  "main.workPhase.blockerPlanFailedWith":
    "Plan {id} did not succeed: {failure}",
  "main.workPhase.blockerPlanStale":
    "The repository changed while plan {id} was being written: it needs to be redone.",
  "main.workPhase.blockerSlicingFailed":
    "Splitting plan {id} into slices did not succeed.",
  "main.workPhase.blockerSlicingFailedWith":
    "Splitting plan {id} into slices did not succeed: {failure}",
  "main.workPhase.blockerProvider":
    "Assignment {id} waits for {provider} to be available again.",
  "main.workPhase.blockerFailed": "Assignment {id} did not succeed.",
  "main.workPhase.blockerFailedWith":
    "Assignment {id} did not succeed: {failure}",
  "main.workPhase.blockerStopped": "Assignment {id} was stopped.",
  "main.workPhase.blockerReviewChanges":
    "The technical review of candidate {id} asks for changes.",
  "main.workPhase.blockerPausedSlice":
    "Slice {slice} is paused: the developer waits for your answer to question {question}.",
  "main.workPhase.blockerPausedAssignment":
    "Assignment {id} is paused: the developer waits for your answer to question {question}.",

  // MARK: Providers and Codex
  // Shared by every provider runtime.
  "main.provider.emptyMessage": "The message is empty.",
  "main.provider.turnRunning": "A turn is already running.",
  "main.opencode.compactFailed": "OpenCode did not compact the session: {error}",
  "main.provider.turnInterrupted": "Turn interrupted.",
  "main.provider.invalidModel": "Invalid model: {model}",
  "main.provider.closed": "{provider} was closed.",
  "main.provider.temporaryLimit": "{provider} hit a temporary rate limit.",
  "main.provider.usageLimit": "{provider} has reached its usage limit.",
  "main.provider.noMethods": "none",

  // registry.ts, codex.ts
  "main.registry.noAdapter":
    "The provider {id} does not have an adapter in Trama yet.",
  "main.codex.writeOutsideThread":
    "The turn asks to write outside the folder of the Codex thread.",

  // acp/acpRuntime.ts
  "main.acpRuntime.notResponding":
    "{provider} is installed but does not respond.",
  "main.acpRuntime.doesNotStart": "{provider} is installed but does not start.",
  "main.acpRuntime.notInstalled":
    "{provider} is not installed or not on the PATH.",
  "main.acpRuntime.accessAction": "access",
  "main.acpRuntime.closedInput": "{provider} closed its input: {error}",
  "main.acpRuntime.closedOutput": "{provider} closed its output: {error}",
  "main.acpRuntime.didNotStart": "{provider} did not start: {error}",
  "main.acpRuntime.exited": "{provider} exited (code {code}).",
  "main.acpRuntime.notRunning": "{provider} is not running.",
  "main.acpRuntime.requestTimeout":
    "{provider} did not answer {method} within {seconds} s.",
  "main.acpRuntime.notAccepting": "{provider} no longer accepts messages.",
  "main.acpRuntime.frameTooLarge":
    "{provider} sent a message over the 8 MB limit.",
  "main.acpRuntime.requestFailed": "ACP request failed.",
  "main.acpRuntime.noModels": "{provider} returned no models.",
  "main.acpRuntime.sessionNewWithoutId":
    "{provider}: session/new response without sessionId.",
  "main.acpRuntime.sessionNotOpen":
    "{provider}: session {session} is not open.",
  "main.acpRuntime.sessionNoLongerOpen":
    "{provider}: session {session} is no longer open.",
  "main.acpRuntime.idleStopped":
    "Turn stopped: {provider} showed no activity for {minutes} min.",
  "main.acpRuntime.signInRequired": "Login required for {provider}: {message}",
  "main.acpRuntime.sessionDidNotStart":
    "{provider} did not start the session: {message}",
  "main.acpRuntime.toolCallFailed": "The tool call failed.",
  "main.acpRuntime.callFailed": "The call failed.",

  // antigravity.ts
  "main.antigravity.notInstalled":
    "Antigravity CLI (agy) is not installed or not on the PATH.",
  "main.antigravity.unknownModel":
    "The model {model} is not available in Antigravity CLI. Change the model and try again. Detail from agy: {detail}",
  "main.antigravity.promptTooLong":
    "On Windows Antigravity accepts at most {max} characters, because the prompt goes on the command line. Shorten the message or attach the content as a file.",
  "main.antigravity.deniedCommand":
    "Denied by Trama: Antigravity cannot run shell commands, because they stay neither in the worktree nor off the network.",
  "main.antigravity.deniedNetwork":
    "Denied by Trama: network tools are not allowed.",
  "main.antigravity.deniedTool":
    "Denied by Trama: with Antigravity only reads, changes in the worktree and Trama's tools are allowed.",
  "main.antigravity.readOnlyDeniedCommand":
    "Denied by Trama: in read-only mode Antigravity cannot run shell commands.",
  "main.antigravity.deniedRead":
    "Denied by Trama: Antigravity reads only in the project, its worktree and the folders Trama allows.",
  "main.antigravity.readOnlyDeniedTool":
    "Denied by Trama: in read-only mode Antigravity can use only the read tools and Trama's tools.",
  "main.antigravity.checkFailed": "The Antigravity CLI check failed: {error}",
  "main.antigravity.versionCheckTimeout":
    "The Antigravity CLI version check timed out.",
  "main.antigravity.versionCheckFailed":
    "The Antigravity CLI version check failed.",
  "main.antigravity.modelsTimeout": "agy models did not answer in time.",
  "main.antigravity.modelsFailed": "agy models failed.",
  "main.antigravity.unknownThread":
    "Unknown Antigravity thread: open it before starting a turn.",
  "main.antigravity.cwdOutsideWorktree":
    "Antigravity works only inside the specialist's worktree: the turn's folder is outside it.",
  "main.antigravity.startFailed": "Antigravity CLI did not start: {error}",
  "main.antigravity.exitedWithoutResult":
    "Antigravity CLI exited without a complete result.",
  "main.antigravity.exitedWithCode": "Antigravity CLI exited with code {code}.",
  "main.antigravity.modelsCheckTimeout":
    "Antigravity CLI is installed, but the model list did not answer in time: Trama could not check the sign-in.",
  "main.antigravity.modelsCheckFailed":
    "Antigravity CLI is installed, but Trama could not check the sign-in by listing the models.",

  // claudeAgent.ts
  "main.claudeAgent.notInstalled":
    "Claude Code not found. Install Claude Code and sign in with `claude login` from the terminal.",
  "main.claudeAgent.signedOut":
    "Claude is not logged in: run `claude login` in the terminal to use it in Trama.",
  "main.claudeAgent.noAuthStatus":
    "This version of Claude Code has no `claude auth status`. Update Claude Code.",
  "main.claudeAgent.authJsonWithoutStatus":
    "Cannot check the Claude sign-in: the JSON output does not state it.",
  "main.claudeAgent.commandExited": "The command exited with code {code}.",
  "main.claudeAgent.authCheckFailed":
    "Cannot check the Claude sign-in. {detail}",
  "main.claudeAgent.authCheckTimeout":
    "Cannot check the Claude sign-in: the command did not answer in time.",
  "main.claudeAgent.authCheckError": "Cannot check the Claude sign-in: {error}",
  "main.claudeAgent.apiKeyLabel": "Claude API key",
  "main.claudeAgent.retryAfter": "Try again after {time}.",
  "main.claudeAgent.usageLimit": "You have reached your Claude usage limit.",
  "main.claudeAgent.toolServerNoAnswer":
    "Trama's tool server did not answer: {error}",
  "main.claudeAgent.orgNotAllowed":
    "The Claude sign-in worked, but this organization does not allow Claude Code.",
  "main.claudeAgent.accountOnHold":
    "The active Claude account is suspended. Fix the account problem and try again.",
  "main.claudeAgent.billingError":
    "Claude payment or subscription problem. Check the active account and try again.",
  "main.claudeAgent.rateLimit":
    "Claude hit its request limit. Wait a moment and try again.",
  "main.claudeAgent.overloaded":
    "Claude is under heavy load right now. Try again in a little while.",
  "main.claudeAgent.invalidRequest": "Claude refused the request as invalid.",
  "main.claudeAgent.modelNotFound":
    "The chosen Claude model is not available for this account.",
  "main.claudeAgent.serverError":
    "Claude returned a server error. Try again in a little while.",
  "main.claudeAgent.maxOutputTokens":
    "Claude reached the maximum answer length before finishing the turn.",
  "main.claudeAgent.turnNotCompleted": "Claude could not complete the turn.",
  "main.claudeAgent.sessionGone":
    "The Claude session no longer exists. Open a new conversation.",
  "main.claudeAgent.sandboxUnavailable":
    "The Claude Code sandbox is not available on this system: changes in the worktree are not allowed.",
  "main.claudeAgent.stoppedWithError": "Claude stopped with an error.",
  "main.claudeAgent.stoppedWithoutCompleting":
    "Claude stopped without completing the turn.",
  "main.claudeAgent.schemaNotMet":
    "Claude could not produce an answer that follows the requested schema.",
  "main.claudeAgent.maxTurns":
    "Claude reached the maximum number of steps for this turn.",
  "main.claudeAgent.modelListTimeout":
    "Timed out waiting for the list of Claude models.",
  "main.claudeAgent.noModels": "Claude Code did not return the models: {error}",

  // opencode.ts
  "main.opencode.notInstalled":
    "OpenCode CLI not found. Install OpenCode (https://opencode.ai) or set the command path in Settings.",
  "main.opencode.truncated": "[truncated]",
  "main.opencode.emptyOutput": "<empty>",
  "main.opencode.serverStartTimeout":
    "Timed out waiting for the OpenCode server to start.",
  "main.opencode.serverExitedBeforeStart":
    "The OpenCode server exited before it started (code {code}).",
  "main.opencode.notExecutable":
    "OpenCode CLI not found or not executable. Install OpenCode (https://opencode.ai).",
  "main.opencode.cannotStart": "Cannot start OpenCode: {error}",
  "main.opencode.apiMissing":
    "This version of OpenCode does not expose the API Trama needs (GET /provider → HTTP {status}). Update OpenCode.",
  "main.opencode.unreachable": "unreachable",
  "main.opencode.serverNotResponding":
    "The OpenCode server does not respond (GET /provider → {outcome}).",
  "main.opencode.invalidProviderList":
    "OpenCode returned an invalid provider list.",
  "main.opencode.invalidModel":
    "Invalid OpenCode model: {model}. Use the provider/model format.",
  "main.opencode.sessionFailed": "The OpenCode session failed.",
  "main.opencode.notResponding": "OpenCode does not respond: {error}",
  "main.opencode.emptyProviderList":
    "OpenCode returned an empty provider list.",
  "main.opencode.connectProvider":
    "Connect a provider in OpenCode with `opencode auth login` to use it in Trama.",
  "main.opencode.permissionsNotApplied":
    "OpenCode did not apply Trama's permissions: {error}",
  "main.opencode.noSessionCreated":
    "OpenCode session.create did not return a session.",
  "main.opencode.messageNotAccepted":
    "OpenCode did not accept the message: {error}",
  "main.opencode.serverExited": "The OpenCode server exited (code {code}).",
  "main.opencode.reservedServerName":
    "An OpenCode MCP server uses the name {name}, which is reserved for Trama's tools.",
  "main.opencode.toolsNotConnectedDetail":
    "OpenCode did not connect Trama's tools: {error}",
  "main.opencode.toolsNotConnected": "OpenCode did not connect Trama's tools.",
  "main.opencode.permissionPolicyNotApplied":
    "OpenCode did not apply Trama's permission policy: {error}",
  "main.opencode.turnWithoutAnswer":
    "OpenCode closed the turn without an answer.",

  // pi.ts
  "main.pi.toolServerStatus": "Trama's tool server answered {status}.",
  "main.pi.invalidMcpResponse": "Invalid MCP response.",
  "main.pi.mcpError": "MCP error.",
  "main.pi.hostToolFailed": "The Trama tool failed.",
  "main.pi.invalidToolCatalog": "tools/list returned an invalid catalog.",
  "main.pi.sdkUnavailable": "Pi SDK not available: {error}",
  "main.pi.credentialsUnreadable": "Pi could not read the credentials: {error}",
  "main.pi.toolsNotConnected": "Pi could not connect Trama's tools: {error}",
  "main.pi.modelUnavailable": "The Pi model {model} is not available.",
  "main.pi.sessionStartFailed": "The Pi session did not start: {error}",
  "main.pi.extensionsNotBound": "Pi could not connect its extensions: {error}",
  "main.pi.sessionNotOpen": "The Pi session is not open.",
  "main.pi.imageUnreadable": "Cannot read the attached image: {path}",
  "main.pi.sessionNoLongerOpen": "The Pi session is no longer open.",
  "main.pi.turnFailed": "The Pi turn failed.",
  "main.pi.toolFailed": "The tool failed.",

  // acp/cursor.ts
  "main.cursor.cannotCheckAccess":
    "This version of Cursor Agent cannot report its sign-in status. Update cursor-agent.",
  "main.cursor.accessCheckFailed":
    "Trama cannot check the Cursor Agent sign-in.",
  "main.cursor.notInstalled":
    "Cursor Agent CLI (cursor-agent) not found. Install it and sign in with `cursor-agent login`.",
  "main.cursor.accessCheckTimeout":
    "Cursor Agent did not answer the sign-in check.",
  "main.cursor.accessCheckError":
    "Trama cannot check the Cursor Agent sign-in: {error}",

  // acp/devin.ts
  "main.devin.browserOnly":
    "Devin only offers a browser sign-in ({methods}). Set WINDSURF_API_KEY or run `devin auth login`, then try again.",
  "main.devin.noHeadlessMethod":
    "Devin offers no sign-in method without a browser (methods offered: {methods}). Update Devin.",
  "main.devin.serverUrlRejected":
    "The Devin API server address is not accepted: it needs HTTPS (HTTP only on loopback) and no credentials in the URL.",
  "main.devin.notInstalled":
    "Devin CLI (devin) not found. Install it and sign in with `devin auth login`.",
  "main.devin.apiKeyLabel": "Devin API key",
  "main.devin.cliSignInLabel": "Devin CLI sign-in",

  // acp/droid.ts
  "main.droid.noSignIn":
    "Droid is not logged in: run `droid` to sign in or set FACTORY_API_KEY.",
  "main.droid.notInstalled":
    "Droid CLI (droid) not found. Install it and sign in by running `droid`.",
  "main.droid.apiKeyLabel": "Factory API key",
  "main.droid.cliSignInLabel": "Droid CLI sign-in",

  // acp/grok.ts
  "main.grok.apiKeyRequired":
    "Missing API key for Grok: set XAI_API_KEY or run `grok login`.",
  "main.grok.browserOnly":
    "Grok is not logged in with a method that works without a browser. Run `grok login` and try again (methods offered: {methods}).",
  "main.grok.apiKeyNotOffered":
    "Grok does not offer API key authentication even though XAI_API_KEY is set (methods offered: {methods}). Update Grok.",
  "main.grok.noHeadlessMethod":
    "Grok offers no sign-in method without a browser (methods offered: {methods}). Update Grok.",
  "main.grok.notInstalled":
    "Grok CLI (grok) not found. Install it and sign in with `grok login`.",
  "main.grok.apiKeyLabel": "xAI API key",
  "main.grok.cliSignInLabel": "Grok CLI sign-in",

  // codexClient.ts
  "main.codexClient.notInstalled":
    "Codex CLI not found. Install Codex and sign in with ChatGPT from the terminal or from Connections.",
  "main.codexClient.mcpInventoryMissing":
    "Codex did not return the MCP inventory that the restricted runtime needs.",
  "main.codexClient.mcpInventoryUnreadable":
    "The MCP inventory cannot be read.",
  "main.codexClient.mcpEntryWithoutName":
    "The MCP inventory has an entry without a valid name.",
  "main.codexClient.reservedServerName":
    "A global MCP server uses the name {name}, which is reserved for Trama's tools.",
  "main.codexClient.fileChangeAction": "Change to {path}",
  "main.codexClient.invalidAccountRead": "invalid account/read response",
  "main.codexClient.accountWithoutPlan": "ChatGPT account without a plan",
  "main.codexClient.usageExhausted":
    "You have used up your ChatGPT usage (plan {plan}).",
  "main.codexClient.unknownAccountType": "unknown",
  "main.codexClient.incompleteLoginStart":
    "incomplete account/login/start response",
  "main.codexClient.modelListTooManyPages":
    "model/list went over the page limit",
  "main.codexClient.incompleteModelList": "incomplete model/list response",
  "main.codexClient.threadStartWithoutId":
    "thread/start response without thread.id",
  "main.codexClient.turnStartWithoutId": "turn/start response without turn.id",
  "main.codexClient.unsupportedAccount":
    "Trama only accepts a ChatGPT account. Codex uses an account of type {type}.",
  "main.codexClient.signIn":
    "Login required: sign in with ChatGPT from Connections to use Codex.",
  "main.codexClient.appServerExited": "Codex app-server exited (code {code}).",
  "main.codexClient.appServerClosedPipe":
    "Codex app-server closed the connection: {error}",
  "main.codexClient.incompleteInitialize": "incomplete initialize response",
  "main.codexClient.appServerNotRunning": "Codex app-server is not running.",
  "main.codexClient.requestTimeout": "Timed out waiting for {method}.",
  "main.codexClient.rpcError": "JSON-RPC error",
  "main.codexClient.modelError": "model error",
  "main.codexClient.unknownError": "unknown error",

  // MARK: Checks, reviewers, deep review and conventions
  // gate.ts
  "main.gate.checksFailedNote": "Did not start: a required check did not pass.",
  "main.gate.environmentNote":
    "Did not start: a required check could not run because of the sandbox or the machine.",
  "main.gate.environmentFailure":
    "The checks {checks} could not run because of the sandbox or the machine: start the review again when they run.",
  "main.gate.overruled": "The Coordinator overruled the reviewers' findings: {reason}",
  "main.gate.settledTitle": "The Coordinator decided between {developer} and the reviewers on candidate {candidate}",
  "main.gate.againstPact": "It goes against the Pact decision {decision} ({value}): it is a suggestion and does not stop the work.",
  "main.gate.overruledTitle": "The Coordinator overruled a finding of {reviewer} on candidate {candidate}",
  "main.gate.overruledDetail": "Finding overruled: {finding}. Reason: {reason}. Pact decisions: {decisions}.",
  "main.gate.settledFindings": "The reviewers are right: {reason}",
  "main.gate.settledDeveloper": "The developer is right: {reason}",
  "main.gate.settledDoubt": "Doubt: {doubt}",
  "main.gate.secretNote":
    "Did not start: the diff contains a secret, and Trama does not send it to the models.",
  "main.gate.secretTitle": "Secret in the diff: {secret}",
  "main.gate.secretDetail":
    "Trama found it before the reviewers: remove the secret from the work and, if it is a real key, revoke it.",
  "main.gate.secretReport":
    "Trama found in the diff: {secrets}. No model received the diff.",
  "main.gate.noSuiteReport":
    "The candidate requires no build or test: there is no suite to compare.",
  "main.gate.noSuiteTitle": "No suite to compare",
  "main.gate.noSuiteDetail": "The required checks include no build or test.",
  "main.gate.regressionTitle": "Regression: {check}",
  "main.gate.regressionDetail":
    "{check} passes on the base and fails on the candidate.",
  "main.gate.notComparable": "{check} cannot be compared",
  "main.gate.alreadyFailing": "{check} already fails on the base",
  "main.gate.changesRequested": "The reviewer asks for changes",
  "main.gate.reviewsFailed": "{names}: the review did not finish. The Coordinator runs it again by itself.",
  "main.gate.interrupted":
    "The review stopped when Trama closed. The Coordinator runs it again by itself.",
  "main.gate.summary.skipped": "{name}: {report}.",
  "main.gate.summary.skippedDefault": "skipped",
  "main.gate.summary.failed": "{name}: the review did not finish, it runs again.",
  "main.gate.summary.running": "{name}: in progress.",
  "main.gate.summary.blocking":
    "{name}: {count} blocking findings, the first: {first}.",
  "main.gate.summary.blocking.one":
    "{name}: 1 blocking finding, the first: {first}.",
  "main.gate.summary.suggestions": "{name}: {count} suggestions.",
  "main.gate.summary.suggestions.one": "{name}: 1 suggestion.",
  "main.gate.summary.nothing": "{name}: nothing to report.",
  "main.gate.summary.secretOthers":
    "The other reviewers did not start: the diff contains a secret, and Trama does not send it to the models.",
  "main.gate.summary.checksFailed": "Checks not passed: {checks}.",
  "main.gate.summary.checksOthers":
    "The other reviewers did not start: the failed check goes to the debugger.",
  "main.gate.waiting.specialistBusy":
    "The developer is working on another assignment: they resume this one when free.",
  "main.gate.waiting.parallelLimit":
    "The developers at work are already at the project's limit: the work resumes when one is free.",
  "main.gate.waiting.workNotIndependent":
    "Someone is working on the same modules: the work resumes when they finish.",
  "main.gate.waiting.noWorktree":
    "The assignment's working copy is gone: a new assignment is needed.",
  "main.gate.waiting.specialistRemoved":
    "The developer is no longer in the team: a new assignment is needed.",
  "main.gate.waiting.stopped":
    "The work was stopped on request: the Coordinator resumes it in its working copy when it is time.",
  "main.gate.waiting.decisionUnderReview":
    "A Pact decision the work relies on is under review: the work resumes with the answer.",
  "main.gate.unreadableAnswer":
    "The reviewer did not return a readable report.",
  "main.gate.malformedFinding":
    "The reviewer returned a finding outside the schema: the review does not count.",

  // quality.ts
  "main.quality.secret.privateKey": "private key",
  "main.quality.secret.githubToken": "GitHub token",
  "main.quality.secret.apiKey": "API key",
  "main.quality.secret.awsKey": "AWS key",
  "main.quality.secret.slackToken": "Slack token",
  "main.quality.secret.googleKey": "Google key",
  "main.quality.secret.assignedCredential": "assigned credential",
  "main.quality.sensitiveFile": "sensitive file {path}",
  "main.quality.secretIn": "{label} in {file}",
  "main.quality.aFile": "a file",
  "main.quality.blocker.BASE_CHANGED": "the project base changed",
  "main.quality.blocker.DECISION_CHANGED": "a decision changed",
  "main.quality.blocker.UNRESOLVED_CHOICE": "there is an unresolved choice",
  "main.quality.blocker.EXTERNAL_EFFECT_UNSUPPORTED":
    "there is an unsupported external effect",
  "main.quality.blocker.EVIDENCE_MISSING": "a check was not run",
  "main.quality.blocker.EVIDENCE_STALE": "a check no longer holds",
  "main.quality.blocker.CHECK_FAILED": "a check did not pass",
  "main.quality.blocker.GATE_BLOCKED": "a reviewer has a blocking finding",
  "main.quality.blocker.GATE_RUNNING": "the reviewers are still at work",
  "main.quality.blocker.GATE_FAILED": "a reviewer did not finish the review",
  "main.quality.blocker.REMOTE_CONFLICT":
    "there is a conflict with the work on GitHub",
  "main.quality.blocker.CLOUD_CHECK_FAILED":
    "the work of the cloud session did not pass the checks on the Mac",
  "main.quality.blocker.WORKTREE_CONFLICT":
    "there is a conflict with the work of another assignment",
  "main.candidates.worktreeChanged": "The working copy changed after this candidate: declare a new candidate from it.",
  "main.quality.blocker.WORKTREE_CHANGED": "the working copy changed after the candidate",
  "main.quality.blocker.SEMANTIC_CONFLICT":
    "a check fails together with the work of another assignment",
  "main.quality.verified.missing": "Not verified: {blockers}.",
  "main.quality.verified.fix":
    "Ask the Coordinator to fix the work and verify a new candidate.",
  "main.quality.verified.passed":
    "All required checks passed in the sandbox ({count}).",
  "main.quality.commit.noAssignment":
    "Trama cannot find the candidate's assignment.",
  "main.quality.commit.fix":
    "Ask the Coordinator to fix the message with set_commit_message.",
  "main.quality.commit.rulesFrom": "{header} (rules from {sources})",
  "main.quality.secrets.found": "Found: {secrets}.",
  "main.quality.secrets.fix":
    "Remove the secret or the file from the work and declare a new candidate; an exposed key must also be revoked.",
  "main.quality.secrets.none": "No secrets or sensitive files in the changes.",
  "main.quality.diffCheck.notRun":
    "git diff --check was not run on this candidate.",
  "main.quality.diffCheck.notRunFix":
    "Ask the Coordinator to declare a new candidate: Trama checks it when it is declared.",
  "main.quality.diffCheck.fix":
    "Remove the trailing spaces and the conflict markers, then declare a new candidate.",
  "main.quality.diffCheck.clean": "git diff --check is clean.",
  "main.quality.issue.linked": "Linked to issue #{issue}.",
  "main.quality.issue.missing":
    "Slice {slice} does not have its GitHub issue yet.",
  "main.quality.issue.missingFix":
    "Publish the slices of plan {plan} on GitHub, then open the pull request again.",
  "main.quality.issue.none": "The work has no issue to link.",
  "main.quality.pact.open": "Pact questions still open: {questions}.",
  "main.quality.pact.openFix":
    "Answer the open questions or withdraw them with a reason.",
  "main.quality.pact.settled": "No Pact decision is left open.",
  "main.quality.mandate.fix":
    "Grant or correct the mandate with the Open pull requests action, then prepare the pull request.",
  "main.quality.mandate.allowed": "The mandate allows opening pull requests.",

  // auditFindings.ts
  "main.auditFindings.noQuote":
    "The proof does not quote the text of the line.",
  "main.auditFindings.unread": "Trama does not read this path: {reason}",
  "main.auditFindings.outsideFiles":
    "`{file}` is outside the files Trama reads.",
  "main.auditFindings.place.candidateCopy": "in the candidate's working copy",
  "main.auditFindings.place.candidate": "on this candidate",
  "main.auditFindings.place.projectCopy": "in the project",
  "main.auditFindings.place.module": "on the {name} module",
  "main.auditFindings.place.project": "on the project",
  "main.auditFindings.fileMissing":
    "The file {file} does not exist {copy}.",
  "main.auditFindings.lineMissing":
    "The file {file} has {lines} lines: line {line} does not exist.",
  "main.auditFindings.quoteMissing":
    "Line {line} of {file} does not contain the text the axis quoted.",
  "main.auditFindings.lineHeld":
    "Trama read {file}:{line} and the line contains the quoted text.",
  "main.auditFindings.commandNotOurs":
    "Trama runs only its own checks, and this command is not one of this review's.",
  "main.auditFindings.checkPassed":
    "Trama ran {check} {on} and the check passed.",
  "main.auditFindings.checkFailed":
    "Trama ran {check} {on} and the check did not pass.",
  "main.auditFindings.reproduction":
    "Trama does not run reproductions written by a model.",
  "main.auditFindings.noProof":
    "The axis gave no proof: it stays a hypothesis.",
  "main.auditFindings.contradicted":
    "{basis} The proof does not hold: it stays a hypothesis.",
  "main.auditFindings.minor":
    "{basis} The finding is not serious: it stays a hypothesis.",
  "main.auditFindings.unreadableConfirmation":
    "The second model did not return a readable answer.",
  "main.auditFindings.incompleteConfirmation":
    "The second model answered without an outcome or without a reason.",
  "main.auditFindings.unconfirmed": "{basis} {failure} It stays a hypothesis.",
  "main.auditFindings.confirmed": "Confirmed by {model}: {reason}",
  "main.auditFindings.rejected": "{model} does not confirm it: {reason}",
  "main.auditFindings.noStrongerModel":
    "No model stronger than the axes' model is available to confirm it.",

  // audit.ts
  "main.audit.running":
    "Deep review on candidate {candidate} is already running.",
  "main.audit.commitIssuesSource": "Issues {issues} cited in the commits",
  "main.audit.commitIssuesSource.one": "Issue {issues} cited in the commits",
  "main.audit.sliceSource": "Slice {slice} of plan {plan}",
  "main.audit.sliceSourceIssue": "Slice {slice} of plan {plan}, issue #{issue}",
  "main.audit.unreadableAnswer": "The axis did not return a readable report.",
  "main.audit.emptyReport": "The axis answered without a report.",
  "main.audit.noFindings": "no findings",
  "main.audit.findings": "{count} findings",
  "main.audit.findings.one": "1 finding",
  "main.audit.axisFailed": "{title}: failed.",
  "main.audit.axisLine": "{title}: {findings}.",
  "main.audit.axisLineWorst": "{title}: {findings}, the most serious: {worst}.",
  "main.audit.noReport": "No axis produced a report.",
  "main.audit.verificationStopped":
    "The verification stopped before rechecking the proof.",
  "main.audit.interrupted":
    "Deep review stopped when Trama closed: open it again.",

  // checks.ts
  "main.checks.title.gitStatus": "Git status",
  "main.checks.title.gitDiffCheck": "whitespace and conflict markers",
  "main.checks.title.nodeTest": "Node tests",
  "main.checks.title.nodeTypecheck": "Node typecheck",
  "main.checks.noDependencies":
    "The project checkout has no installed dependencies (node_modules): run npm ci in the project.",
  "main.checks.dependenciesDiffer":
    "The candidate's dependencies differ from the checkout's (package-lock.json): npm ci would be needed, and the checks do not run it because they have no network.",
  "main.checks.nodeModulesNotIgnored":
    "git does not ignore node_modules in this project: Trama does not link the dependencies, so the candidate does not change.",
  "main.checks.sandboxLoopback":
    "[Trama] Some failures come from the sandbox: the network is allowed only to 127.0.0.1, internet is blocked.",
  "main.checks.sandboxNoNetwork":
    "[Trama] Some failures come from the sandbox without network: on this system Trama has no sandbox that allows the local network, so tests that open a server on 127.0.0.1 cannot run here.",

  // conventions.ts
  "main.conventions.existingBranches": "existing branches",
  "main.conventions.emptyMessage": "The message is empty.",
  "main.conventions.spaceAfterColon":
    "The colon needs a space before the description.",
  "main.conventions.colonPlacement":
    "The colon goes right after the type or the scope, with no spaces.",
  "main.conventions.scopeParentheses":
    "The scope goes in a single pair of parentheses, right after the type.",
  "main.conventions.headerForm":
    'The title must start with a type followed by a colon and a space, for example "feat: add the search palette". Current title: "{header}".',
  "main.conventions.typeNotAllowed":
    'The type "{type}" is not one the project allows: {types}.',
  "main.conventions.emptyScope":
    "The scope in parentheses is empty: write it or remove the parentheses.",
  "main.conventions.scopeSpaces":
    'The scope "{scope}" is a name without spaces.',
  "main.conventions.scopeNotAllowed":
    'The scope "{scope}" is not one the project allows: {scopes}.',
  "main.conventions.missingDescription":
    "The description after the colon is missing.",
  "main.conventions.descriptionSpacing":
    "The description follows the colon and a single space.",
  "main.conventions.descriptionCut":
    'The description looks cut in the middle: it ends with "{end}". Write it in full.',
  "main.conventions.headerTooLong":
    "The title has {length} characters: the project allows at most {max}.",
  "main.conventions.bodyBlankLine":
    "The body starts after a blank line below the title.",
  "main.conventions.footerSpaces":
    'The footer token "{token}" uses spaces: use hyphens ({hyphenated}).',
  "main.conventions.breakingUppercase":
    '"{token}" must be written in uppercase: BREAKING CHANGE.',
  "main.conventions.breakingDescription":
    "BREAKING CHANGE must describe the incompatible change.",
  "main.conventions.breakingForm":
    "{token} is followed by a colon, a space and the description.",
  "main.conventions.invalidMessage": "Invalid commit message: {problems}",
  "main.conventions.branchType":
    'The branch "{branch}" starts with a type: {prefixes}.',
  "main.conventions.branchDescription":
    "A short description is needed after the type.",
  "main.conventions.releaseCharacters":
    "The description uses only lowercase letters, digits, hyphens and dots.",
  "main.conventions.branchCharacters":
    "The description uses only lowercase letters, digits and hyphens; dots only in release/ versions.",
  "main.conventions.branchRepeats":
    "Hyphens and dots must not repeat, nor sit at the start or the end.",

  // practices.ts
  "main.practices.evidence.review": "Technical review with changes requested",
  "main.practices.evidence.check": "Check {check} not passed",
  "main.practices.evidence.failure": "Assignment failed",
  "main.practices.evidence.wait": "Assignment waiting for a blocked provider",
  "main.practices.evidence.conflict": "Conflict reproduced with other work",
  "main.practices.retiredByPerson": "Retired by the person",

  // referenceCheck.ts
  "main.referenceCheck.title": "Reference Trama cannot find",
  "main.referenceCheck.detail":
    "The reply cites {ids}, which do not exist in Trama's data: they stay plain text.",
  "main.referenceCheck.detail.one":
    "The reply cites {ids}, which does not exist in Trama's data: it stays plain text.",

  // coordinatorGrounding.ts
  "main.coordinatorGrounding.missingTitle":
    "Cited button that is not there now",
  "main.coordinatorGrounding.quoted": "“{label}”",
  "main.coordinatorGrounding.named":
    "the buttons {buttons}, which are not there now",
  "main.coordinatorGrounding.named.one":
    "the button {buttons}, which is not there now",
  "main.coordinatorGrounding.canUse": "Now you can use: {buttons}.",
  "main.coordinatorGrounding.noButton": "Now there is no button to press.",
  "main.coordinatorGrounding.detail": "The Coordinator named {named}. {now}",

  // MARK: Coordinator loop: continuous work, status line, recap, team
  // Status line
  "main.statusLine.nothingGoingOn": "Nothing in progress.",
  "main.statusLine.paused":
    "Coordinator paused: running turns finish, then nothing starts until you resume it.",
  "main.statusLine.list": "{items} and {last}",
  "main.statusLine.running.preparePlan": "Preparing the plan",
  "main.statusLine.running.assignTarget": "Assigning {target}",
  "main.statusLine.running.assignWork": "Assigning the work",
  "main.statusLine.running.verifyTarget": "Checking {target}",
  "main.statusLine.running.verifyWork": "Checking the work",
  "main.statusLine.running.startRoute": "Starting the route",
  "main.statusLine.running.answerQuestion": "Answering a developer",
  "main.statusLine.running.answerMessage": "Answering your message",
  "main.statusLine.running.clearCandidate": "Giving the candidate the green light",
  "main.statusLine.running.study": "Studying the project",
  "main.statusLine.running.writingPlan": "Writing the plan",
  "main.statusLine.running.slicingPlan": "Splitting the plan into slices",
  "main.statusLine.next.preparePlan": "prepare the plan",
  "main.statusLine.next.assignTarget": "assign {target}",
  "main.statusLine.next.assignWork": "assign the work",
  "main.statusLine.next.verifyTarget": "check {target}",
  "main.statusLine.next.verifyWork": "check the work",
  "main.statusLine.next.settleReview": "decide between the developer and the reviewers",
  "main.statusLine.next.clearCandidate": "give the candidate the green light",
  "main.statusLine.next.answerQuestion": "answer the developer",
  "main.statusLine.next.startRoute": "start the route",
  "main.statusLine.next.waitForYou": "wait for you",
  "main.statusLine.nowThen": "{now}, then I {next}.",
  "main.statusLine.waitingForYou": "Waiting for you to go on.",
  "main.statusLine.nextIsMine": "The next step is mine: {next}.",
  "main.statusLine.continuousOff": "Continuous work is off: the Coordinator waits for a message from you.",
  "main.statusLine.continuousOffNext": "With it on, the next step would be mine: {next}.",
  "main.statusLine.workStopped": "The work is stopped.",
  "main.statusLine.manyAgents": "{count} agents are at work",
  "main.statusLine.workingOn": "{names} work on {slices}",
  "main.statusLine.workingOn.one": "{names} works on {slices}",
  "main.statusLine.working": "{names} are working",
  "main.statusLine.working.one": "{names} is working",
  "main.statusLine.sliceWaits": "Slice {slice} waits for {waitedFor}.",
  "main.statusLine.slicesWait": "Slices {slices} wait for {waitedFor}.",
  "main.statusLine.slicesAndOthersWait":
    "Slices {slices} and others wait for {waitedFor}.",

  // Provider wait and resuming (issue #249)
  "main.resumeWork.atTime": "at {time}",
  "main.resumeWork.onDayAtTime": "on {day} at {time}",
  "main.resumeWork.unreachable":
    "Waiting for {provider} to be reachable again.",
  "main.resumeWork.quotaUntil":
    "Waiting for the {provider} quota to unlock {when}.",
  "main.resumeWork.quota":
    "Waiting for the {provider} quota to unlock: the provider does not say when.",
  "main.resumeWork.limitUntil":
    "Waiting for the {provider} limit to end, expected {when}.",
  "main.resumeWork.limit":
    "Waiting for the {provider} limit to end: the provider does not say when.",
  "main.resumeWork.waitReason":
    "No turn starts until then. Then I resume on my own.",

  // Recap
  "main.recap.sliceDone": "Slice {slice} done{issue}",
  "main.recap.sliceDoneTitled": "Slice {slice} done: {title}{issue}",
  "main.recap.candidateMerged": "Candidate merged with pull request #{number}",
  "main.recap.goalAchieved": "Goal achieved: {title}",
  "main.recap.specIssue": "Opened issue #{number} for the spec",
  "main.recap.specIssueTitled": "Opened issue #{number} for the spec: {title}",
  "main.recap.sliceIssue": "Opened issue #{number} for slice {slice}: {title}",
  "main.recap.problemIssue":
    "Opened issue #{number} for a problem found: {title}",
  "main.recap.fact.preparePlan": "Plan preparation",
  "main.recap.fact.assignWork": "Work assignment",
  "main.recap.fact.verifyCandidate": "Work check",
  "main.recap.fact.answerQuestion": "Answer to the developer",
  "main.recap.fact.answerQuestions": "Answer to the question",
  "main.recap.fact.confirmUnderstanding": "Understanding confirmation",
  "main.recap.fact.grantMandate": "Mandate grant",
  "main.recap.fact.confirmTeam": "Team confirmation",
  "main.recap.fact.confirmSeams": "Test points confirmation",
  "main.recap.fact.confirmSlices": "Slices confirmation",
  "main.recap.fact.reviewPlan": "Plan review",
  "main.recap.fact.reviewCandidate": "Candidate check",
  "main.recap.fact.mergePullRequest": "Pull request merge",
  "main.recap.outcome.running": "in progress",
  "main.recap.outcome.done": "done",
  "main.recap.outcome.stalled": "did not succeed",
  "main.recap.outcome.stopped": "stopped",
  "main.recap.outcome.setAside": "set aside for a message of yours",
  "main.recap.outcome.failed": "ended with an error",
  "main.recap.outcome.corrected": "corrected by you",
  "main.recap.outcome.undone": "undone",
  "main.recap.stepCorrected": "{label} (corrected by you): {detail}",
  "main.recap.moreMoves": "{count} more moves are in Activity",
  "main.recap.moreMoves.one": "One more move is in Activity",
  "main.recap.settled": "I decided between {developer} and the reviewers on candidate {candidate}.",

  // Continuous work
  "main.continuousWork.unblocked":
    "{why} The Coordinator unblocked the work: it is now in {phase}.",
  "main.continuousWork.stillBlocked":
    "{why} The Coordinator did not resolve it in this turn: it tries again at the next event or round.",
  "main.continuousWork.phase.none": "waiting",
  "main.continuousWork.phase.clarification": "clarification",
  "main.continuousWork.phase.spec": "spec",
  "main.continuousWork.phase.slices": "slices",
  "main.continuousWork.phase.execution": "execution",
  "main.continuousWork.phase.verification": "checks",
  "main.continuousWork.phase.candidate": "waiting for the merge",
  "main.continuousWork.phase.merged": "merged",
  "main.continuousWork.phase.blocked": "a block",
  "main.continuousWork.blockResolved":
    "Block resolved by the Coordinator: {kind}",
  "main.continuousWork.blockOpen": "Block still open: {kind}",
  "main.continuousWork.stall.unsettled": "the turn did not decide between the developer and the reviewers: use settle_review.",
  "main.continuousWork.stall.uncleared": "the turn gave the verified candidate no green light: use clear_candidate, or assign the correction.",
  "main.continuousWork.block.checkFailed": "red check",
  "main.continuousWork.block.worktreeConflict":
    "conflict between pieces of work",
  "main.continuousWork.block.stalledAssignment": "stalled assignment",
  "main.continuousWork.block.reviewLoop": "disagreement between developer and reviewers",
  "main.continuousWork.moveFailed":
    "The automatic move did not succeed: {reason}",
  "main.continuousWork.stall.unanswered":
    "the Coordinator did not answer the developer's question.",
  "main.continuousWork.questionHeld":
    "Trama stopped retrying the developer's answer after {attempts} turns without one.",
  "main.continuousWork.questionHeldDetail":
    "The question stays open and its assignment paused. Trama tries again in an hour, or you can write to the Coordinator.",
  "main.continuousWork.moveHeld":
    "Trama stopped retrying the step \"{move}\" after {attempts} turns without a result.",
  "main.continuousWork.moveHeldDetail":
    "The work stays as it is. Write to the Coordinator to take it up again.",
  "main.continuousWork.stall.noPlan": "the Coordinator did not start the plan.",
  "main.continuousWork.stall.noAssignment":
    "the Coordinator did not assign the work.",
  "main.continuousWork.stall.undeclaredMany":
    "assignments {ids} are finished but their candidates were not declared.",
  "main.continuousWork.stall.undeclaredOne":
    "assignment {id} is finished but its candidate was not declared.",
  "main.continuousWork.stall.unverified": "the checks of {ids} did not start.",
  "main.continuousWork.automaticMoveDetail":
    "Coordinator move started by Trama within the mandate, without asking you.",

  // Presence
  "main.coordinatorPresence.agentOf": "{person}'s agent {agent}",

  // The whole cycle within the mandate (A06)
  "main.autonomousCycle.stepNotFound": "Coordinator step not found.",
  "main.autonomousCycle.alreadyCorrected":
    "You already corrected this step: write to the Coordinator in the chat.",
  "main.autonomousCycle.emptyCorrection": "Write what to change.",
  "main.autonomousCycle.correction":
    "I am correcting {what}: {note}\nStart again from that step with my correction.",
  "main.autonomousCycle.what.confirmUnderstanding":
    "the shared understanding you confirmed on your own",
  "main.autonomousCycle.what.confirmTeam": "the team you confirmed on your own",
  "main.autonomousCycle.what.confirmSeams":
    "the test points you confirmed on your own",
  "main.autonomousCycle.what.confirmSlices":
    "the slices you confirmed on your own",
  "main.autonomousCycle.what.formSquads": "the squads you formed on your own",

  // Ask Trama
  "main.askTrama.superseded": "The Coordinator proposed a newer route.",
  "main.askTrama.alreadyAnswered": "You already answered this route.",
  "main.askTrama.noRunnableStep":
    "No step of this route is available in Trama yet.",
  "main.askTrama.declined": "I am not starting Ask Trama route {id} ({steps}).",
  "main.askTrama.start": "Start Ask Trama route {id}: {path}, {steps}.",
  "main.askTrama.firstStep": "First step: {skill}.",
  "main.askTrama.firstStepFlow": "First step: {skill} ({flow}).",
  "main.askTrama.boundary": "Phase boundary: {boundary}.",
  "main.askTrama.startLabel": "Start the Ask Trama route",
  "main.askTrama.startedByDelegation": "Trama started Ask Trama route {id} with your delegation",
  "main.askTrama.startedByMandate": "Trama started Ask Trama route {id} within the mandate",
  "main.askTrama.startedChoice": "Started without waiting for your answer: {steps}.",

  // Agent chat
  "main.agentThreads.sliceSubject": "slice {slice}",
  "main.agentThreads.assignmentSubject": "assignment {id}",

  // Coordinator tools: the cards they open in the chat
  "main.coordinatorTools.card.mandate": "Mandate",
  "main.coordinatorTools.card.decision": "Decision",
  "main.coordinatorTools.card.teamProposal": "Team proposal",
  "main.coordinatorTools.personModel": "Model the person chose for this agent.",
  "main.coordinatorTools.personModelMissing":
    "The model the person chose for this agent is not available now: it works on the Coordinator's default model.",
  "main.coordinatorTools.card.assignment": "Assignment",
  "main.coordinatorTools.card.route": "Ask Trama route",
  "main.coordinatorTools.card.domainProposal": "Glossary and ADR",
  "main.coordinatorTools.card.goal": "Proposed goal",
  "main.coordinatorTools.card.candidate": "Candidate",

  // Team
  "main.team.fixedRoleReason":
    "Every Trama team has this role, in every project.",
  "main.team.inTheTeam": "In the team",
  "main.team.confirmed": "I confirmed the team you proposed: {members}.",
  "main.team.corrected": "I corrected the team: {members} stay.",
  "main.team.removed": "I removed {names}.",
  "main.team.superseded": "The previous team proposal no longer applies.",
  "main.team.left": "Left the team: {why}",
  "main.team.assignmentReceived": "Assignment received: {objective}",
  "main.team.worktreeReady": "Working copy ready on branch {branch}",
  "main.team.turnRunning": "Turn {number} running with {model}",
  "main.team.stopped": "Stopped: {note}",
  "main.team.assignmentDone": "Assignment finished",
  "main.team.waitsForAnswer": "Waiting for the answer to question {id}",
  "main.team.providerInterrupted": "The provider interrupted the turn.",
  "main.team.turnFailed": "Turn failed: {message}",
  "main.team.waitsForAnswerAfterFailure":
    "Waiting for the answer to question {id}. The turn failed: {message}",
  "main.team.stopRequested": "Stop requested by {actor}: {why}",
  "main.team.resumed": "Assignment resumed with {model}",
  "main.team.resumedWithAnswer": "Resumed with the answer to question {id}",
  "main.team.resumedWithFindings":
    "Resumed with the blocking findings on candidate {id}",
  "main.team.personModelReason": "Model the person chose for this agent.",
  "main.team.providerSet": "Provider set by the person: {provider} {model}",

  // MARK: Pact, mandate, goals, plan, slices and candidates
  // pact.ts
  "main.pact.decisionIncomplete":
    "A decision needs a behavior, an example and a rationale.",
  "main.pact.mandateIncomplete":
    "A mandate needs at least one goal, one module and one authorized action.",
  "main.pact.noMandateToRevoke": "There is no active mandate to revoke.",
  "main.pact.revocationReasonMissing": "Give the reason for the revocation.",
  "main.pact.mandateRequestNotFound": "Mandate request {id} not found.",
  "main.pact.mandateRequestSuperseded":
    "Mandate request {id} was superseded by {newer}: it can no longer be granted.",
  "main.pact.newerRequest": "a newer request",
  "main.pact.mandateRequestAnswered":
    "Mandate request {id} already has an answer.",
  "main.pact.rejectionReasonMissing": "Say why you turn down the proposal.",
  "main.pact.questionNotFound": "Question not found.",
  "main.pact.questionAlreadyAnswered": "You already answered this question.",
  "main.pact.questionWithdrawn":
    "You withdrew this question: it no longer waits for an answer.",
  "main.pact.alternativeInvalid": "Invalid alternative.",
  "main.pact.decisionMissing": "Write your decision.",
  "main.pact.answerRationale": "Answer to the question: {question}",
  "main.pact.answeredNotWithdrawable":
    "You already answered this question: the decision stays, and you revise it with a new decision.",
  "main.pact.questionAlreadyWithdrawn": "You already withdrew this question.",
  "main.pact.withdrawalReasonMissing": "Give the reason for withdrawing it.",
  "main.pact.withdrawalGrilling":
    'I withdrew question {number} of the clarification, round {round}: "{question}". Reason: {reason} It no longer counts as an open question.',
  "main.pact.withdrawal":
    'I withdrew the question "{question}". Reason: {reason}',
  "main.pact.mandateGranted": "I granted the mandate (version {version}).",
  "main.pact.mandateCorrected":
    "I corrected the mandate: it is now at version {version}.",
  "main.pact.mandateRevoked": "I revoked the mandate.",
  "main.pact.mandateRevokedWithReason":
    "I revoked the mandate. Reason: {reason}",
  "main.pact.mandateRejectedKept":
    "I turned down mandate proposal {id}. The mandate in force stays at version {version}, unchanged. Reason: {reason}",
  "main.pact.mandateRejectedNone":
    "I turned down mandate proposal {id}. There is still no mandate. Reason: {reason}",
  "main.pact.decisionAnswered":
    'I answered the question "{question}": {value}. It is decision {id}, version {version} of the Pact.',

  // pactDemo.ts
  "main.pactDemo.approvalRequired": "Approve this exact version.",
  "main.pactDemo.runFirst": "Run the scenario first.",
  "main.pactDemo.notVerified": "The scenario is not verified.",

  // projectMandate.ts
  "main.projectMandate.reason":
    "I propose a mandate for the whole work cycle of the project: understanding, squads, spec, slices, assignment, checks and merge with the green light. You grant it once and can narrow it at any time. The fixed bans stay excluded.",
  "main.projectMandate.objective":
    "Carry the project's work cycle forward: understanding, squads, spec, slices, assignment, checks and merge with the green light.",
  "main.projectMandate.noMandateToRestrict":
    "There is no mandate in force to narrow.",
  "main.projectMandate.restrictionAdds":
    "A restriction removes modules or actions, it does not add them: to widen the mandate, correct it.",
  "main.projectMandate.restrictionEmpty":
    "The narrowed mandate keeps at least one module and one action: to remove everything, revoke it.",
  "main.projectMandate.restrictionNothing": "The restriction removes nothing.",
  "main.projectMandate.removedModules": "removed the modules {modules}",
  "main.projectMandate.removedActions": "removed the actions {actions}",
  "main.projectMandate.dependsOn": "{id} (depends on {dependsOn})",
  "main.projectMandate.halted":
    "I stopped {work}: the working copies stay as they were, the diff is not lost. To resume, plan again and delegate again within the narrowed mandate.",
  "main.projectMandate.nothingHalted":
    "No work in progress was outside the narrowed mandate.",
  "main.projectMandate.restricted":
    "I narrowed the mandate: it is now at version {version}, {parts}. {halted} It applies from your next turn: work outside the narrowed mandate does not restart, the rest goes on.",
  "main.projectMandate.refusalNotFound": "Stopped action not found.",
  "main.projectMandate.refusalTitle": "Action stopped by a fixed ban: {ban}",
  "main.projectMandate.refusalDetail":
    "{reason} No mandate grants it: you find it in Waiting for you.",

  // goals.ts
  "main.goals.titleMissing": "A goal needs a title.",
  "main.goals.titleTooLong": "The title is longer than {limit} characters.",
  "main.goals.outcomeMissing": "Describe the expected outcome of the goal.",
  "main.goals.outcomeTooLong":
    "The expected outcome is longer than {limit} characters.",
  "main.goals.exampleKind": "An example is either accepted or refused.",
  "main.goals.exampleTooLong": "An example is longer than {limit} characters.",
  "main.goals.tooManyExamples": "A goal has at most {limit} examples.",
  "main.goals.notFound": "Goal {id} not found.",
  "main.goals.statusInvalid": "Invalid goal status.",
  "main.goals.onlyCoordinatorProposes": "Only the Coordinator proposes a goal.",
  "main.goals.unknownDecisions": "Unknown decisions: {ids}.",
  "main.goals.alreadyArchived": "The goal is already archived.",
  "main.goals.workRunning":
    "Work on this goal is in progress: stop it or wait for it to end before archiving.",
  "main.goals.notArchived": "The goal is not archived.",
  "main.goals.hasHistory":
    "This goal already has a history in the chat, which stays. You can archive it.",
  "main.goals.candidateNotFound": "Candidate not found.",
  "main.goals.candidateChanged":
    "The candidate changed while you were looking at it: check the examples again on the current version.",
  "main.goals.candidateUnlinked": "The candidate is not linked to a goal.",
  "main.goals.exampleNotFound": "Example not found in the goal.",

  // plan.ts
  "main.plan.specIncomplete":
    "A spec has at least a title, a problem and a solution.",
  "main.plan.specTooLarge": "The spec is larger than the allowed size.",
  "main.plan.invalidJson": "The planner's answer is not valid JSON.",
  "main.plan.otherSnapshot":
    "The spec refers to another snapshot of the project.",
  "main.plan.noSeams": "The planner proposed no test points.",
  "main.plan.fieldMissing": "The planner's spec has no field {field}.",

  // slices.ts
  "main.slices.noSpec": "The plan has no spec to split into slices yet.",
  "main.slices.tooLarge": "The breakdown is larger than the allowed size.",
  "main.slices.invalidJson": "The slicer's answer is not valid JSON.",
  "main.slices.otherSnapshot":
    "The breakdown refers to another snapshot of the project.",
  "main.slices.noSlices": "The slicer proposed no slices.",
  "main.slices.tooMany": "The slicer proposed more than 30 slices.",
  "main.slices.sliceIncomplete":
    "Slice {number} has no title or behavior to deliver.",
  "main.slices.noCriteria": "Slice {number} has no acceptance criteria.",
  "main.slices.blockedByLater":
    "Slice {number} is blocked by {blocker}: a slice can only be blocked by slices listed before it.",

  // slicePicking.ts
  "main.slicePicking.noModules":
    "The slice names no modules: the Coordinator assigns it.",
  "main.slicePicking.notCovered":
    "The mandate does not cover the work of this slice.",
  "main.slicePicking.busy":
    "Waiting until {who}: they work on the same modules.",
  "main.slicePicking.busyWho": "{developer} finishes «{objective}»",
  "main.slicePicking.busyJoin": " and ",
  "main.slicePicking.someDeveloper": "a developer",
  "main.slicePicking.occupied":
    "Someone is touching these modules now: {names}.",
  "main.slicePicking.noDeveloper":
    "No free developer covers the modules of this slice.",
  "main.slicePicking.noDeveloperInSquad": "No free developer of squad {squad} covers the modules of this slice.",
  "main.slicePicking.noProvider": "No connected provider can work now.",
  "main.slicePicking.modelReason":
    "Slice taken independently: the same provider and model as the previous work.",

  // developerQuestions.ts
  "main.developerQuestions.asked": "Question {id} to the Coordinator",
  "main.developerQuestions.answeredFromFacts":
    "The Coordinator answered question {id}",
  "main.developerQuestions.waitingForPerson":
    "Question {id} waits for the person's answer",
  "main.developerQuestions.personDecision":
    "{answer} (decision {decision}, version {version} of the Pact)",
  "main.developerQuestions.personWithdrew":
    "The person withdrew the question without deciding. Reason: {reason}",
  "main.developerQuestions.personAnswered": "The person answered question {id}",

  // focus.ts
  "main.focus.projectWork": "Project work",
  "main.focus.notStarted": "not started",
  "main.focus.taskNotOpen":
    "Task {id} is not open: it is closed or does not exist.",
  "main.focus.taskAlreadyPaused": "Task {id} is already paused.",
  "main.focus.taskNotPaused": "Task {id} is not paused.",

  // candidates.ts
  "main.candidates.gateRunning": "The candidate's reviewers are at work.",
  "main.candidates.gateFailed": "A reviewer did not finish the review.",
  "main.candidates.unknown": "Unknown candidate: {id}.",
  "main.candidates.superseded":
    "The candidate was replaced by newer work: review the new one.",
  "main.candidates.notVerified": "The candidate is not verified: {codes}.",

  // MARK: Repository, GitHub, menu, memory and learning
  // Dialogs of main.ts; the application menu's labels are the "menu.*" keys of the interface catalogs (issue #345)
  "main.dialog.openProject": "Open Project",
  "main.dialog.chooseFolder": "Choose the folder",
  "main.ipc.notTramaWindow": "This action comes from outside Trama's window: I am not running it.",
  "main.ipc.needsGesture": "This yes counts only when you give it, with a click or a key in Trama's window. Try again from the button.",
  "main.dialog.chooseCloneFolder": "Choose where to clone the project",
  // Merge and push (merge.ts, push.ts)
  "main.merge.noRemote":
    "The project has no GitHub remote: Trama does not open or merge the pull request.",
  "main.merge.mandateDoesNotCover":
    "The mandate does not cover integrating these modules: the candidate waits for your review.",
  "main.merge.superseded": "The candidate was replaced by more recent work.",
  "main.merge.alreadyMerged": "The candidate is already merged.",
  "main.merge.personPublishes":
    "The person reviews and publishes this candidate.",
  "main.merge.notVerified": "The candidate is not verified.",
  "main.merge.gateNotPassed": "The candidate did not pass the reviewers.",
  "main.merge.noClearance":
    "The Coordinator's green light on this candidate is missing.",
  "main.merge.clearanceOtherMandate": "The green light was given under a mandate other than the one in force: a new green light is needed.",
  "main.merge.running": "Trama is merging the candidate.",
  "main.merge.stopped": "The merge of this candidate stopped.",
  "main.merge.githubRefused": "GitHub did not merge the pull request.",
  "main.merge.rejectedByPerson":
    "The person rejected the candidate: it goes back to the developer.",
  "main.merge.action": "Merge of the pull request of candidate {id}",
  "main.merge.actionOnBranch":
    "Merge of the pull request of candidate {id} ({branch})",
  "main.merge.candidateNotFound": "Candidate not found.",
  "main.merge.rejectMerged":
    "The candidate is already merged: ask the Coordinator for a fix.",
  "main.merge.rejectNeedsReason":
    "Write why you reject the candidate: the reason goes back to the developer.",
  "main.merge.mergedByCoordinator":
    "Candidate {id} merged with the Coordinator's green light",
  "main.merge.mergedByPerson": "Candidate {id} merged with your ok",
  "main.merge.mergedDetail": "Pull request #{number}: {url}",
  "main.merge.failed": "Merge of candidate {id} failed",
  "main.merge.destructiveTitle": "Merge stopped: your decision is needed",
  "main.merge.destructiveDetail": "{reasons} You find it in Waiting for you with consequences and alternatives.",
  "main.merge.destructive.breaking": "Incompatible change.",
  "main.merge.destructive.breakingConsequence": "Whoever uses this part must adapt: {breaking}",
  "main.merge.destructive.deletes": "Deletes {count} files.",
  "main.merge.destructive.deletes.one": "Deletes a file.",
  "main.merge.destructive.deletedConsequence": "After the merge they are no longer on the main branch: {files}.",
  "main.merge.destructive.andOthers": " and {count} more",
  "main.merge.destructive.sql": "Contains instructions that delete data.",
  "main.merge.destructive.sqlConsequence": "When the instructions run, the removed data does not come back without a backup.",
  "main.merge.destructive.mergeAnyway": "Merge anyway, if the consequences are fine with you: Trama merges with your ok.",
  "main.merge.destructive.askSafer": "Ask the Coordinator for a version that removes nothing, for example deprecate first and remove later.",
  "main.merge.destructive.leave": "Do not merge and leave things as they are.",
  "main.merge.destructive.stopped": "The Coordinator does not merge this candidate on its own: {reasons}",
  "main.merge.destructive.noStop": "The candidate has no stopped merge.",
  "main.merge.drift.newWork": "Other work reached the branch of pull request #{number} after publication: a new candidate with new checks is needed.",
  "main.merge.drift.conflicts": "GitHub finds conflicts between pull request #{number} and the base.",
  "main.merge.banned": "Merge stopped by a fixed ban",
  "main.merge.bannedDetail":
    "{reason} No mandate allows it: candidate {id} is waiting for you.",
  "main.push.noMandate":
    "The project has no mandate: Trama does not publish branches on GitHub.",
  "main.push.mandateRevoked":
    "The mandate is revoked: Trama does not publish branches on GitHub.",
  "main.push.mandateNoPullRequests":
    "The mandate does not allow opening pull requests: Trama does not publish branches on GitHub.",
  "main.push.bannedReason":
    "{reason} No mandate allows it: Trama does not publish {branch}.",
  "main.push.exitCode": "exit {code}",
  "main.push.failedError": "git push failed: {detail}",
  "main.push.where": "{branch} on {remote}",
  "main.push.banned": "Publication stopped by a fixed ban",
  "main.push.refused": "Publication stopped by the mandate",
  "main.push.started": "Trama is publishing a branch on GitHub",
  "main.push.pushed": "Trama published a branch on GitHub",
  "main.push.failed": "Branch publication failed",
  "main.push.agentPushed": "An agent ran git push outside Trama",
  "main.push.agentTried": "An agent tried to publish with git push",
  "main.push.agentPushedDetail":
    "Request: {command}\nCheck the remote: only Trama publishes, and only with a mandate that allows it.",
  "main.push.agentTriedDetail":
    "Request: {command}\nThe sandbox stopped it: only Trama publishes, and only with a mandate that allows it.",
  // Publication (publication.ts)
  "main.publication.noWorktree":
    "The assignment has no working copy to publish.",
  "main.publication.worktreeChanged":
    "The working copy changed after the candidate was declared: a new candidate with new checks is needed.",
  "main.publication.missingMarker":
    "The commit message does not carry the candidate marker ({marker}).",
  "main.publication.extraFiles":
    "The index contains files outside the candidate: {files}.",
  "main.publication.unmergedFiles":
    "The merge in the working copy still has files in conflict: {files}. Resolve them before the commit.",
  "main.publication.pullRequestClosed":
    "Pull request #{number} of this branch is already closed: the new candidate needs a new assignment.",
  "main.publication.createFailed":
    "GitHub did not create the pull request: {detail}",
  "main.publication.listFailed":
    "GitHub did not list the pull requests: {detail}",
  // GitHub (github.ts)
  "main.github.issueMissing": "GitHub did not return the created issue.",
  "main.github.mergeFailed":
    "GitHub did not merge pull request #{number}: {detail}",
  "main.github.unknownError": "unknown error",
  "main.github.ghMissing":
    "GitHub CLI (gh) is not installed. Install it and run gh auth login.",
  "main.github.signedOut":
    "GitHub CLI has no valid sign-in. Run gh auth login in the terminal.",
  "main.github.sso":
    "The organization requires SSO: authorize the gh token for the organization (gh auth refresh).",
  "main.github.rateLimited":
    "GitHub applied a request limit. Trama will try again later.",
  "main.github.notFound":
    "The repository does not exist or your account has no access to it (private repository).",
  // Conflicts (conflicts.ts, worktreeConflicts.ts)
  "main.conflicts.invalidRevision": "Invalid revision: {sha}",
  "main.conflicts.remoteUnavailable": "Remote revision not available: {detail}",
  "main.conflicts.unsafePath": "Unsafe path in the candidate: {path}",
  "main.conflicts.tooLarge":
    "The candidate exceeds the limit of the merge probe.",
  "main.conflicts.changedDuringProbe":
    "The candidate changed during the probe.",
  "main.conflicts.diffUnreadable": "The candidate's diff cannot be read.",
  "main.conflicts.doesNotApply": "The candidate does not apply to its base.",
  "main.conflicts.noMergeBase":
    "The two revisions have no common base that can be checked.",
  "main.conflicts.clean":
    "The temporary merge was reproduced without text conflicts.",
  "main.conflicts.mergeTreeFailed":
    "git merge-tree did not complete the probe: {detail}",
  "main.conflicts.conflict": "The temporary merge produces text conflicts.",
  "main.conflicts.overlap":
    "No text conflict, but both revisions change {files}.",
  "main.conflicts.worktreeOverlap":
    "No text conflict between the two working copies, but both change {files}.",
  "main.conflicts.worktreeConflict":
    "The temporary merge of the two working copies produces text conflicts: they are resolved before the merge.",
  // Worktrees (workspace.ts)
  "main.workspace.invalidName": "The working copy name is not valid.",
  "main.workspace.headNotCommit": "HEAD is not a commit.",
  "main.workspace.invalidBranch": "Invalid branch name: {problems}",
  "main.workspace.unsafePath": "Unsafe path: {path}",
  "main.workspace.notManaged": "The working copy is not managed by Trama.",
  "main.workspace.sessionMismatch":
    "The working copy no longer matches the session.",
  "main.workspace.branchChanged": "The working copy branch changed.",
  "main.workspace.symlink": "Symbolic link in the candidate: {path}",
  "main.workspace.diffFailed": "git diff failed",
  "main.workspace.diffCheckFailed": "git diff --check failed",
  "main.workspace.uncommitted":
    "The working copy has changes not saved in a commit: removing it would lose them.",
  "main.workspace.unpublished":
    "The working copy has unpublished commits: publish the candidate or keep it.",
  // Presence (presence.ts)
  "main.presence.cacheFailed": "Presence cache not created: {detail}",
  "main.presence.recordTooLarge": "The presence record exceeds the limit.",
  "main.presence.remoteSilent": "The remote does not answer.",
  "main.presence.notUpdated": "Presence is not up to date: {detail}",
  "main.presence.remoteDidNotAnswer": "The remote did not answer: {detail}",
  "main.presence.noRemote":
    "The project has no remote: presence stays on this computer.",
  "main.presence.noAccount":
    "Trama does not know your account yet: presence starts as soon as it reads it.",
  "main.presence.readOnly":
    "You only have read access to this remote: you see your colleagues' presence without sharing yours.",
  "main.presence.rejected":
    "The remote does not accept your presence ({detail}): you see your colleagues' presence without sharing yours.",
  "main.presence.you": "You",
  "main.presence.notPublished": "Presence was not published: {detail}",
  // Problems outside the work in progress (problems.ts)
  "main.problems.unknownCommit": "unknown",
  "main.problems.checkTitle": "The {check} check fails on the project branch",
  "main.problems.checkoutDetail":
    "The {check} check (`{command}`) fails on the project checkout at commit {commit}.",
  "main.problems.checkoutDetailRegression":
    "The {check} check (`{command}`) fails on the project checkout at commit {commit}, and it passed before.",
  "main.problems.checkOutput": "Check output:\n\n```\n{output}\n```",
  "main.problems.checkoutEvidence":
    "{check} check red on the checkout at commit {commit} ({id})",
  "main.problems.gateDetail":
    "The `{check}` check fails on candidate {candidate} and also on its base, commit {commit}: the candidate did not cause it.",
  "main.problems.baseOutput": "Output on the base:\n\n```\n{output}\n```",
  "main.problems.gateEvidence":
    "{check} check red also on base {commit} of candidate {candidate} ({id})",
  "main.problems.findingDetail":
    "{name} found this problem in `{file}`, a file that candidate {candidate} does not change.",
  "main.problems.findingEvidence":
    "Finding by {name} on candidate {candidate} ({id})",
  "main.problems.issueEvidence": "**Evidence:** {evidence}.",
  "main.problems.issueOpenedAlone":
    "Trama's Coordinator opened this issue on its own, because the problem is outside the work in progress. Bug triage sorts it with `triage`.",
  "main.problems.triageOutcome": "Triage: {state} ({label}).",
  "main.problems.triageUnreadable": "Triage {id} gave no readable outcome.",
  "main.problems.issueAlreadyOpen":
    "The issue was already open: triage follows the rules for new issues.",
  "main.problems.placedOnAssignment":
    "{note} Assignment {id} is already working on this problem.",
  "main.problems.placedInBacklog":
    "{note} No assignment is working on this problem: it stays in the backlog.",
  "main.problems.localBacklog":
    "GitHub is not connected: the problem stays in Trama's backlog, without an issue.",
  // Document, storage and onboarding (document.ts, storage.ts, onboarding.ts)
  "main.document.quitNote":
    "Trama was closed while the Coordinator was working.",
  "main.document.crashNote":
    "Trama closed without stopping the turn while the Coordinator was working.",
  "main.document.assignmentQuitNote":
    "Quit: Trama is closing. The assignment resumes when Trama reopens, if the mandate allows it.",
  "main.document.assignmentCrashNote":
    "Trama stopped without a controlled shutdown (a crash or a forced quit) while the developer was working.",
  "main.document.specInterrupted":
    "Writing the spec stopped at the closing: Trama takes it up by itself with your answer.",
  "main.document.planInterrupted":
    "The preparation stopped at the closing: the Coordinator does it again by itself.",
  "main.document.slicingInterrupted":
    "The split into slices stopped at the closing: the Coordinator does it again by itself.",
  "main.storage.symlink": "The state file is a symbolic link: {path}",
  "main.storage.unreadable":
    "The project state cannot be read and stays unchanged in {path}. {detail}",
  "main.storage.tooManyImages":
    "You can attach at most {max} images per message.",
  "main.storage.unsupportedImage": "Image format not supported: {name}.",
  "main.storage.imageTooLarge":
    "The image {name} is larger than 10 MB or empty.",
  "main.onboarding.ghTimeout":
    "gh auth status did not answer within 15 seconds.",
  "main.onboarding.cloneTimeout":
    "Cloning {repository} did not finish within 10 minutes.",
  "main.onboarding.cloneNeedsAccess":
    "{repository} cannot be cloned without access. If it is private, connect GitHub CLI with gh auth login and try again.",
  "main.onboarding.repositoryCreateFailed": "Could not create the repository {name} on GitHub.",
  "main.onboarding.cloneFailed": "Cloning {repository} failed.",
  "main.onboarding.cloneFailedReason": "Cloning {repository} failed: {reason}",
  "main.onboarding.unsafePath": "Unsafe path in the exercise: {path}",
  "main.onboarding.nothingToCompare":
    "The candidate changes no file: there is nothing to compare.",
  "main.onboarding.compatibleLabel": "simulated compatible change",
  "main.onboarding.incompatibleLabel": "simulated incompatible change",
  // Skill setup (skillSetup.ts)
  "main.skills.unsafePath": "The setup cannot use the path: {path}",
  "main.skills.missingResource":
    "A required AI Hero resource is missing: skills/{skill}/SKILL.md",
  "main.skills.tooLarge":
    "The AI Hero resources exceed the local limit of 3 MB: {bytes} bytes.",
  "main.skills.conflictPreserved": "Conflict preserved: {path}.",
  "main.skills.changedNotUpdated": "Changed by you, not updated: {path}.",
  "main.skills.changedKeptOldName":
    "Changed by you, kept with the old name: {path}.",
  "main.skills.nothingToRollBack": "There is no method update to undo.",
  // Interface screenshots (interfaceShots.ts)
  "main.shots.defaultName": "screen",
  "main.shots.timeout":
    "The {script} script did not finish within {seconds} seconds.",
  "main.shots.failed": "The {script} script failed: {detail}",
  "main.shots.noPng":
    "The {script} script saved no PNG in TRAMA_SCREENSHOTS_DIR.",
  "main.shots.noScript":
    'The project does not declare the "{script}" script in package.json: Trama cannot take the before and after screenshots. Look at the diff or try the candidate\'s branch.',
  "main.shots.baseWithoutScript":
    'The base does not have the "{script}" script yet: there are only the after screenshots.',
  "main.shots.sideFailed": "{side}, {theme} theme: {failure}",
  "main.shots.before": "Before",
  "main.shots.after": "After",
  "main.shots.light": "light",
  "main.shots.dark": "dark",
  "main.shots.notPrepared": "Trama did not prepare the screenshots: {detail}",
  // Repository scan (repositoryScanner.ts)
  "main.scanner.invalidRoot": "The repository folder cannot be read: {path}",
  "main.scanner.invalidRelativePath": "The path must be relative: {path}",
  "main.scanner.unsafePath": "The path is not available for reading: {path}",
  "main.scanner.fileTooLarge": "The file exceeds the reading limit: {path}",
  "main.scanner.unreadableAttributes": "Cannot read the attributes of {path}.",
  "main.scanner.stopped": "The scan stopped at {count} source files.",
  "main.scanner.fileTooLargeSkipped":
    "File skipped because it exceeds {size} KB: {path}.",
  "main.scanner.unreadableFile":
    "Unreadable or non UTF-8 file skipped: {path}.",
  "main.scanner.wholeProject": "The whole project",
  "main.scanner.moduleSummary":
    "{files} files found in {path}. For Swift only direct imports are listed; for the other languages the files and the resolvable relative imports stay available.",
  "main.scanner.contextSkipped": "Context file skipped: {name}. {detail}",
  // Projects overview (overview.ts)
  "main.overview.decisions": "{count} decisions requested",
  "main.overview.decisions.one": "{count} decision requested",
  "main.overview.mandates": "{count} mandate requests",
  "main.overview.mandates.one": "{count} mandate request",
  "main.overview.teams": "{count} team proposals",
  "main.overview.teams.one": "{count} team proposal",
  "main.overview.blocked": "{count} jobs stopped or failed",
  "main.overview.blocked.one": "{count} job stopped or failed",
  "main.overview.toApprove": "{count} results to approve",
  "main.overview.toApprove.one": "{count} result to approve",
  "main.overview.running": "{count} assignments in progress",
  "main.overview.running.one": "{count} assignment in progress",
  "main.overview.waitingForCapacity":
    "{count} assignments wait for a free developer",
  "main.overview.waitingForCapacity.one":
    "{count} assignment waits for a free developer",
  "main.overview.ciFailing": "CI red on {count} pull requests",
  "main.overview.ciFailing.one": "CI red on {count} pull request",
  "main.overview.demoName": "Example project",
  // GitHub monitor (monitor.ts)
  "main.monitor.ghFailed": "gh api {endpoint} failed",
  "main.monitor.branchesLimited":
    "Branch list limited to the first {count} results.",
  "main.monitor.pullsLimited":
    "Pull request list limited to the first {count} results.",
  "main.monitor.renamed":
    "The repository was renamed to {name}: update the origin remote.",
  "main.monitor.branchCreated": "New branch {branch}",
  "main.monitor.branchForcePushed": "Force push on {branch}",
  "main.monitor.branchUpdated": "New commits on {branch}",
  "main.monitor.branchDeleted": "Branch {branch} deleted",
  "main.monitor.pullOpened": "Opened #{number} {title}",
  "main.monitor.pullOpenedFromFork": "Opened #{number} {title} (from a fork)",
  "main.monitor.pullUpdated": "Updated #{number} {title}",
  "main.monitor.pullUpdatedFromFork": "Updated #{number} {title} (from a fork)",
  "main.monitor.reviewApproved": "approved",
  "main.monitor.reviewChanges": "changes requested",
  "main.monitor.reviewCommented": "commented",
  "main.monitor.review": "Review of #{number}: {label}",
  "main.monitor.ciGreen": "CI of #{number}: green",
  "main.monitor.ciFailed": "CI of #{number}: failed",
  "main.monitor.pullClosed": "Closed #{number} {title}",
  // Example project and SwiftUI import (demoProject.ts, legacyImport.ts)
  "main.demo.folderTaken":
    "The example folder already exists and is not managed by Trama. Move or rename it to create the example project again.",
  "main.legacy.importedTitle": "{title} (imported from the SwiftUI version)",
  // Memory errors (learning/memoryErrors.ts)
  "main.memory.userFull":
    "The profile is full ({chars} of {limit} characters): remove or shorten a note before adding another one.",
  "main.memory.projectFull":
    "The project Memory is full ({chars} of {limit} characters): remove or shorten a note before adding another one.",
  "main.memory.noMatch": "This note is gone: the Memory changed.",
  "main.memory.ambiguous":
    "The given text matches more than one note: fix them one at a time.",
  "main.memory.drift":
    "The Memory file changed outside Trama: Trama does not overwrite it and saved a copy next to it.",
  "main.memory.unreadable":
    "Trama cannot read the Memory file right now. Try again shortly.",
  "main.memory.threat":
    "The note contains instructions that Trama does not save in Memory.",
  "main.memory.disabled": "This Memory is turned off in Settings.",
  "main.memory.staleProposal":
    "The Memory changed after the proposal: the entries it touched are no longer the same. Discard it.",
  "main.memory.unknownProposal": "This proposal is gone.",
  "main.memory.notUpdated": "The Memory was not updated.",
  "main.memory.activity.full": "Memory not updated: it is full.",
  "main.memory.activity.noMatch":
    "Memory not updated: the note to change is gone.",
  "main.memory.activity.ambiguous":
    "Memory not updated: the given text matches more than one note.",
  "main.memory.activity.drift":
    "Memory not updated: the file changed outside Trama.",
  "main.memory.activity.unreadable":
    "Memory not updated: the file cannot be read right now.",
  "main.memory.activity.threat":
    "Memory not updated: the note contained instructions that Trama does not save.",
  "main.memory.activity.tooManyFailures":
    "Memory not updated: too many attempts in this turn.",
  "main.memory.activity.disabled":
    "Memory not updated: it is turned off in Settings.",
  "main.memory.activity.notUpdated": "Memory not updated.",
  // Learning: proposals and reviews (learning/projectLearning.ts, learning/review.ts)
  "main.memory.change.remove": "Remove the note «{old}»",
  "main.memory.change.replace": "Replace the note «{old}» with «{content}»",
  "main.memory.change.add": "Add the note «{content}»",
  "main.memory.change.other": "Change the note: «{content}»",
  "main.memory.reorder": "Reorder {count} notes",
  "main.memory.reorderOneChanges":
    "Reorder {count} notes: one changes or goes away",
  "main.memory.reorderChanges":
    "Reorder {count} notes: {removed} change or go away",
  "main.memory.userOverLimit":
    "The profile is over the limit ({chars} of {limit} characters). Trama proposes removing the oldest notes; you can also shorten them by hand.",
  "main.memory.projectOverLimit":
    "The project Memory is over the limit ({chars} of {limit} characters). Trama proposes removing the oldest notes; you can also shorten them by hand.",
  "main.review.verb.created": "created",
  "main.review.verb.updated": "updated",
  "main.review.verb.rewritten": "rewritten",
  "main.review.verb.deleted": "deleted",
  "main.review.verb.archived": "archived",
  "main.review.skillLine": "Skill '{name}' {verb}",
  "main.review.skillLineWithPath": "Skill '{name}' {verb} ({path})",
  "main.review.stopped": "The review was stopped.",
  "main.review.timedOut": "The review ran out of time.",
  "main.review.foreignTool":
    "The review used a tool outside Memory and skills: Trama stopped it.",
  "main.review.staged": "Proposed Memory change: you find it in Memory",
  "main.review.profileUpdated": "Profile updated",
  "main.review.memoryUpdated": "Memory updated",
  // MARK: Cloud sessions (A19)
  "main.controller.cloudNotStarted": "The cloud session did not start: {error}",
  "main.controller.cloudNotStartedTitle": "Cloud session not started",
  "main.controller.cloudStartingTitle": "Starting the cloud session",
  "main.controller.cloudStartedTitle": "Cloud session started",
  "main.controller.cloudNoLink":
    "Claude Code did not give the link of the session.",
  "main.controller.cloudStoppedWhileStarting":
    "Stopped by the person while the cloud session was starting.",
  "main.controller.cloudPullClosed":
    "Pull request #{number} was closed before Trama's checks.",
  "main.controller.cloudPullClosedTurn":
    "Pull request #{number} of the cloud session was closed before Trama's checks.",
  "main.controller.cloudFailedTitle": "Cloud session failed",
  "main.controller.cloudOpenedDraft":
    "The cloud session opened draft pull request #{number}.",
  "main.controller.cloudReturnedTitle": "Cloud session back on the Mac",
  "main.controller.cloudReturnedDetail":
    "Draft pull request #{number}, branch {branch}: {url}",
  "main.controller.macChecksFailedTitle": "Checks on the Mac not passed",
  "main.controller.macChecksPassedTitle": "Checks on the Mac passed",
  "main.controller.macChecksFailedDetail":
    "{problems} The candidate stays on hold until the work passes them.",
  "main.controller.macChecksPassedDetail":
    "No secrets or sensitive files, git diff --check clean, valid commit messages.",
  "main.controller.cloudNotReturned":
    "The work of the cloud session did not come back to the Mac: {error}",
  "main.controller.cloudNotReturnedTitle": "Cloud session not back on the Mac",
  "main.controller.notCloudAssignment":
    "The assignment does not work in a cloud session.",
  "main.controller.cloudNoGitHubRemote":
    "The project has no GitHub remote: Trama cannot read the session.",
  "main.controller.assignmentNotFound": "Assignment not found.",
  "main.controller.cannotMovePlace":
    "You can move the assignment before it starts or while it waits to resume.",
  "main.controller.movedToCloudTitle": "Moved to the cloud",
  "main.controller.movedToLocalTitle": "Moved to the Mac",
  "main.controller.movedToCloudDetail":
    "At the next resume it works in a cloud session, if the cloud can be used.",
  "main.controller.movedToLocalDetail":
    "At the next resume it works on the Mac.",
  "main.controller.invalidWorkPlace":
    "The place of work must be Automatic, Always local or Cloud when possible.",
  "main.controller.cloudNoWorkingCopy":
    "The work of the cloud session has no working copy on the Mac.",
  "main.controller.cloudWorkingCopyChanged":
    "The working copy changed after the candidate: a new candidate with new checks is needed.",
  "main.controller.macChecksFailedDraft":
    "{problems} Pull request #{number} stays a draft.",
  "main.controller.macChecksRepeatedFailed":
    "Trama ran the publication checks again on the Mac and they did not pass: {problems}",
  "main.controller.pullReadyTitle": "Pull request #{number} ready for review",
  "main.controller.pullReadyDetail":
    "Checks on the Mac passed, draft removed: {url}",
  "main.cloud.startTimeout":
    "Claude Code did not open the cloud session within five minutes.",
  "main.cloud.exited": "claude --cloud exited with {code}.",
  "main.cloud.invalidBranch": "Branch name not valid: {problems}",
  "main.cloud.pullsNotListed": "GitHub did not list the pull requests: {error}",
  "main.cloud.pullNotUpdated":
    "GitHub did not update the pull request: {error}",
  "main.cloud.draftNotRemoved":
    "GitHub did not take the pull request out of draft: {error}",
  "main.cloud.secrets": "Secrets or sensitive files: {items}.",
  "main.cloud.sensitiveFiles": "Sensitive files in the branch: {files}.",
  "main.cloud.diffCheck": "git diff --check is not clean: {errors}.",
  "main.cloud.noCommits": "The branch has no commits beyond the base.",
  "main.cloud.invalidCommit":
    'Commit message not valid "{subject}": {problems}',
  "main.team.cloudWorking": "Working in a cloud session on branch {branch}",
  "main.workspace.notTramaBranch": "Branch {branch} is not a Trama branch.",
  "main.workspace.fetchFailed": "git fetch of branch {branch} failed: {error}",
  "main.workspace.noCommonBase":
    "Branch {branch} has no common base with the project.",
  // MARK: Findings to work and semantic conflicts
  "main.findingWork.followUp.ticket": "an issue or a backlog item",
  "main.findingWork.followUp.assignment": "an assignment",
  "main.findingWork.followUp.pactCard": "a Pact card",
  "main.findingWork.notDone":
    "The review is not finished: wait for the report before acting on the findings.",
  "main.findingWork.notFound": "Finding not found in this review.",
  "main.findingWork.alreadyCreated":
    "You already created {what} from this finding.",
  "main.findingWork.noProof": "no proof",
  "main.findingWork.quotedLine": "{label}, quoted line: {quote}",
  "main.findingWork.command": "the command {command}",
  "main.findingWork.reproduction": "reproduction:\n{steps}",
  "main.findingWork.moduleNamed": "the {name} module",
  "main.findingWork.project": "the project",
  "main.findingWork.candidateOf": "{author}'s candidate",
  "main.findingWork.candidateReviewed": "the reviewed candidate",
  "main.findingWork.markdown.title": "**Finding {source}:** {title}",
  "main.findingWork.markdown.titleSerious":
    "**Finding {source}, serious:** {title}",
  "main.findingWork.markdown.status": "**Status:** {status}.",
  "main.findingWork.markdown.proof": "**Proof:** {proof}",
  "main.findingWork.markdown.observed": "What Trama read:",
  "main.findingWork.markdown.origin":
    "It comes from the deep review of {candidate}, fixed point {point}.",
  "main.findingWork.issueOpenedFrom":
    "The person opened this issue from a finding of Trama's deep review.",
  "main.findingWork.localTicket":
    "GitHub is not connected: the finding stays in Trama's backlog, without an issue.",
  "main.findingWork.evidenceLabel":
    "Finding of the deep review of {candidate}, proof {proof}",
  "main.findingWork.hypothesis":
    "The finding is a hypothesis: its proof did not hold. Open an issue or a Pact card for it, not an assignment.",
  "main.findingWork.teamNotConfirmed":
    "The squad is not confirmed yet: nobody can take the assignment.",
  "main.findingWork.noModule":
    "Trama does not know which module the finding belongs to: ask the Coordinator for the fix.",
  "main.findingWork.mandateMissing":
    "There is no mandate: no assignment starts outside the mandate. Open an issue, or grant the mandate.",
  "main.findingWork.mandateRevoked":
    "The mandate is revoked: no assignment starts outside the mandate. Open an issue, or grant a new mandate.",
  "main.findingWork.outsideScope":
    "The mandate does not cover {modules}: no assignment starts outside the mandate. Open an issue.",
  "main.findingWork.noWorktreeAction":
    "The mandate does not allow work in working copies: no assignment starts outside the mandate. Open an issue.",
  "main.findingWork.busy":
    "Another assignment is working on {modules} now: try again when it finishes.",
  "main.findingWork.occupied":
    "Someone is touching these modules now: {names}. Try again later.",
  "main.findingWork.noDeveloper":
    "No free developer covers the modules of the finding: try again when one finishes their work.",
  "main.findingWork.noProvider": "No connected provider can work now.",
  "main.findingWork.objective": "Fix the finding: {title}",
  "main.findingWork.modelReason":
    "Fix of a deep review finding: the same provider and model as the reviewed work.",
  "main.findingWork.seam": "The finding does not come back: {proof}",
  "main.findingWork.notStarted": "The assignment did not start: {error}",
  "main.findingWork.pact.question":
    "Is the finding «{title}» a trade-off to accept, or should it be fixed?",
  "main.findingWork.pact.case": "Deep review of {candidate}, {source}.",
  "main.findingWork.pact.proof": "Proof: {proof}.",
  "main.findingWork.pact.acceptBehavior":
    "Accept the trade-off: the code stays as it is and the finding «{title}» is not fixed.",
  "main.findingWork.pact.acceptExample": "{proof} stays as in the candidate.",
  "main.findingWork.pact.acceptConsequence":
    "The Pact records the trade-off and no assignment starts.",
  "main.findingWork.pact.fixBehavior": "Fix the finding «{title}».",
  "main.findingWork.pact.fixExample":
    "{proof} changes until the finding no longer comes back.",
  "main.findingWork.pact.fixConsequence":
    "The fix becomes an assignment within the mandate.",
  "main.findingWork.report.passed": "passed",
  "main.findingWork.report.failed": "not passed",
  "main.findingWork.report.serious": "**Serious.** ",
  "main.findingWork.report.item": "{serious}{title} ({status}; proof: {proof})",
  "main.findingWork.report.noSpec":
    "No spec available: the axis did not start.",
  "main.findingWork.source.axisOf": "of the {axis} axis",
  "main.findingWork.source.axis": "{axis} axis",
  "main.findingWork.source.lensOf": "of Trama's {lens} lens",
  "main.findingWork.source.lens": "Trama's {lens} lens",
  "main.findingWork.report.lensTitle": "### {lens} (Trama lens)",
  "main.findingWork.report.lensFailed": "The lens did not produce a report.",
  "main.findingWork.report.noFindings": "No findings.",
  "main.findingWork.report.title": "## Deep review of {candidate}",
  "main.findingWork.report.scope":
    "Fixed point {point}, {files} files. Read-only review.",
  "main.findingWork.report.scope.one":
    "Fixed point {point}, 1 file. Read-only review.",
  "main.findingWork.report.checks": "### Real checks",
  "main.findingWork.report.noChecks": "No check was run.",
  "main.findingWork.report.summary": "**Summary:** {summary}",
  "main.findingWork.report.note":
    "A finding is verified only when Trama checked its proof again; the others stay hypotheses.",
  "main.findingWork.publishNotDone":
    "The review is not finished: only a finished report is published.",
  "main.findingWork.alreadyPublished":
    "You already published this report on GitHub.",
  "main.semanticConflicts.pending":
    "Trama tries the scenario on the combined candidate: until it gives a result, it is only a hypothesis.",
  "main.semanticConflicts.passes":
    "On the combined candidate {check} passes: the incompatibility stays a hypothesis.",
  "main.semanticConflicts.notRun":
    "The scenario did not start ({reason}): the incompatibility stays a hypothesis.",
  "main.semanticConflicts.unknownReason": "unknown reason",
  "main.semanticConflicts.incompatible":
    "Each passes {check} alone, but it fails on the combined candidate: the two changes are incompatible.",
  "main.semanticConflicts.notProven":
    "On the combined candidate {check} fails, but it did not pass on both alone: the failure does not prove the incompatibility.",
  "main.conflicts.textConflicts":
    "The temporary merge of the two working copies produces text conflicts.",
  "main.conflicts.combineFailed":
    "git merge-tree did not complete the merge: {error}",
  "main.controller.semanticOtherAssignment": "another assignment",
  "main.controller.semanticNotificationTitle":
    "Trama: two pieces of work do not work together",
  "main.controller.semanticNotificationBody":
    "The work of {first} and the work of {second} pass alone, but together a check fails.",
  "main.controller.semanticWorkingCopyGone":
    "One of the two working copies is gone.",
  "main.controller.auditNotFound": "Review not found.",
  "main.controller.findingIssueFailed": "The issue was not opened: {error}",
  "main.controller.findingIssueOpenedTitle":
    "Issue #{number} opened from a deep review finding",
  "main.controller.findingBacklogTitle":
    "A deep review finding goes to Trama's backlog",
  "main.controller.findingAssignedTitle":
    "{name} gets the fix of a deep review finding",
  "main.controller.findingAssignedOrigin": "It comes from {candidate}.",
  "main.controller.auditNoRepository":
    "No GitHub repository connected: the report stays in Trama.",
  "main.controller.auditReportIssueTitle":
    "Deep review report of {candidate}",
  "main.controller.auditReportNotPublished":
    "The report was not published: {error}",
  // MARK: Redaction before publishing (issue #391)
  "main.redaction.token": "token removed",
  "main.redaction.iban": "IBAN removed",
  "main.redaction.pec": "PEC removed",
  "main.redaction.email": "email removed",
  "main.redaction.fiscalCode": "fiscal code removed",
  "main.redaction.vatNumber": "VAT number removed",
  "main.redaction.sdiCode": "SDI code removed",
  "main.redaction.shopDomain": "shop domain removed",
  "main.redaction.address": "address removed",
  "main.redaction.placeholderAt": "{what}, see {where}",
  // MARK: Squads by product area (A10)
  "main.squads.developerName": "{area} developer",
  "main.squads.developerCompetence": "Develops the {area} area.",
  "main.squads.developerReason": "The Coordinator added them within the mandate: squad {area} had no developer.",
  "main.squads.leadName": "{area} lead",
  "main.squads.leadReason": "Every squad has a squad lead: this one belongs to squad {area}.",
  "main.squads.qaReason": "Every squad has a dedicated QA: this one belongs to squad {area}.",
  "main.squads.summarySquad": "Squad {squad} with {lead} (squad lead), {developers} ({role}) and {qa} (dedicated QA).",
  "main.squads.developers": "developers",
  "main.squads.developers.one": "developer",
  "main.squads.joins": "{developer} joins squad {squad}.",
  "main.squads.hired": "Added within the mandate: {names}.",
  "main.requestedAction.notFound": "Action not found.",
  "main.delegation.approvedBy": "Coordinator with your delegation",
  "main.delegation.mandateTitle": "Mandate v{version} with the full delegation",
  "main.delegation.mandateDetail": "Every module and every delegable action, because the person gave the full delegation.",
  "main.delegation.newModulesDetail": "The full delegation also covers the project's new modules: {modules}.",
  "main.delegation.ticketSubject": "Issue #{number}: {title}",
  "main.delegation.ticketTaken": "Taken with the full delegation ({label}).",
  "main.delegation.stalled": "the Coordinator did not decide what waited for the person.",
  "main.delegation.ticketStalled": "the turn did not turn issue #{number} into work.",
  "main.delegation.candidateSubject": "Candidate {id}",
  "main.delegation.approvedAfterShots": "Approved after the screenshots",
  "main.delegation.mandateObjective": "Carry on all the project's work with the full delegation",
  "main.slicePicking.squadsFull": "The squads at work are at their limit: the slice starts when one frees up.",

  // Discussions between agents (A12, issue #252)
  "main.discussions.activity.timeBox": "Discussion closed at the end of its time box: {motive}",
  "main.discussions.activity.turnFailed": "A turn of the discussion failed: {motive}",
  "main.discussions.closed": "The discussion is closed: write to the Coordinator.",
  "main.discussions.emptyMessage": "Write the message.",
  "main.discussions.modelSetting": "The model of the discussions must be the lightest or the role's.",
  "main.discussions.noProposal.estimate": "No shared estimate within the time box: the plan's estimate stands and the squad reviews it at the next planning.",
  "main.discussions.noProposal.blocker": "No proposal within the time box: the blocked work stays still and the Coordinator takes the blocker up again at the next round.",
  "main.discussions.noProposal.review": "No proposal within the time box: the candidate stays as it is and goes through Trama's checks.",
  "main.discussions.noProposal.conflict": "No proposal within the time box: the two pieces of work stay apart and the Coordinator takes the conflict up again at the next round.",
};
