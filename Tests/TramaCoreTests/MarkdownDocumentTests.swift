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
            .task(text: "Da verificare", checked: false),
            .task(text: "Completato", checked: true),
            .bullet("Voce normale"),
            .ordered(number: 1, text: "Primo passo"),
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
}
