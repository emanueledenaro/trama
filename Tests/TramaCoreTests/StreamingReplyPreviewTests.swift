import XCTest
@testable import TramaCore

final class StreamingReplyPreviewTests: XCTestCase {
    private func preview(_ partial: String) -> String? { StreamingReplyPreview.message(fromPartialJSON: partial) }

    func testReturnsNilBeforeTheMessageKeyArrives() {
        XCTAssertNil(preview(#"{"kind":"expla"#))
    }

    func testReturnsNilWhenKeyIsPresentButValueHasNotStarted() {
        XCTAssertNil(preview(#"{"kind":"explanation","message""#))
        XCTAssertNil(preview(#"{"kind":"explanation","message":"#))
    }

    func testReturnsEmptyStringOnceTheOpeningQuoteArrives() {
        XCTAssertEqual(preview(#"{"kind":"explanation","message":""#), "")
    }

    func testReturnsPartialTextWhileStreaming() {
        XCTAssertEqual(preview(#"{"kind":"explanation","message":"Il modulo Orders gest"#), "Il modulo Orders gest")
    }

    func testStopsAtTheClosingQuoteAndIgnoresLaterFields() {
        XCTAssertEqual(preview(#"{"kind":"explanation","message":"Fatto.","references":["a.swift"]}"#), "Fatto.")
    }

    func testDecodesEscapedNewlinesQuotesAndBackslashes() {
        XCTAssertEqual(preview(#"{"message":"Riga 1\nRiga \"due\" \\ fine"#), "Riga 1\nRiga \"due\" \\ fine")
    }

    func testDecodesUnicodeEscapes() {
        XCTAssertEqual(preview(#"{"message":"Città"#), "Città")
    }

    func testDropsAnIncompleteEscapeAtTheEnd() {
        XCTAssertEqual(preview(#"{"message":"Citt\u00"#), "Citt")
        XCTAssertEqual(preview(#"{"message":"Citt\"#), "Citt")
    }

    func testIgnoresWhitespaceAroundColon() {
        XCTAssertEqual(preview(#"{ "message" : "Ciao"#), "Ciao")
    }

    func testDoesNotMatchAMessageKeyInsideAnotherStringValue() {
        XCTAssertEqual(preview(#"{"kind":"la parola \"message\" qui","message":"Vero"#), "Vero")
    }
}
