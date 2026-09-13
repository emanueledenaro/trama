import XCTest
@testable import TramaCore

final class MarkdownDocumentTests: XCTestCase {
    func testParsesIssueStructureWithoutExecutingItsContent() {
        let source = """
        # Titolo

        Testo con **enfasi**
        sulla stessa idea.

        ## Criteri

        - [ ] Da verificare
        - [x] Completato
        - Voce normale
          - Sotto voce
        1. Primo passo

        | Stato | Prova |
        | --- | --- |
        | Aperto | CI |

        ```swift
        print("solo testo")
        ```
        """

        let document = MarkdownDocument.parse(source)

        XCTAssertEqual(document.blocks, [
            .heading(level: 1, text: "Titolo"),
            .paragraph("Testo con **enfasi** sulla stessa idea."),
            .heading(level: 2, text: "Criteri"),
            .task(text: "Da verificare", checked: false, level: 0),
            .task(text: "Completato", checked: true, level: 0),
            .bullet(text: "Voce normale", level: 0),
            .bullet(text: "Sotto voce", level: 1),
            .ordered(number: 1, text: "Primo passo", level: 0),
            .table(headers: ["Stato", "Prova"], rows: [["Aperto", "CI"]]),
            .code(language: "swift", text: "print(\"solo testo\")")
        ])
    }

    func testKeepsQuotesAndDividersAsPresentationOnly() {
        let document = MarkdownDocument.parse("""
        > Non eseguire questa frase.

        ---

        Testo finale.
        """)

        XCTAssertEqual(document.blocks, [
            .quote("Non eseguire questa frase."),
            .divider,
            .paragraph("Testo finale.")
        ])
    }

    func testNormalizesCRLFAndKeepsAShortFenceInsideALongerFence() {
        let source = "# Titolo\r\n\r\n| A | B |\r\n| --- | --- |\r\n| x | y |\r\n\r\n````markdown\r\n```swift\r\nprint(1)\r\n```\r\n````"

        let document = MarkdownDocument.parse(source)

        XCTAssertEqual(document.blocks, [
            .heading(level: 1, text: "Titolo"),
            .table(headers: ["A", "B"], rows: [["x", "y"]]),
            .code(language: "markdown", text: "```swift\nprint(1)\n```")
        ])
    }

    func testKeepsAnEscapedPipeInsideItsTableCell() {
        let document = MarkdownDocument.parse("""
        | Espressione | Esito |
        | --- | --- |
        | `a \\| b` | valido |
        """)

        XCTAssertEqual(document.blocks, [
            .table(headers: ["Espressione", "Esito"], rows: [["`a | b`", "valido"]])
        ])
    }
}
