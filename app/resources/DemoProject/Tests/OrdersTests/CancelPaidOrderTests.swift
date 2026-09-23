import Catalog
import Inventory
import Orders
import Payments
import Users
import XCTest

final class CancelPaidOrderTests: XCTestCase {
    func testPaidOrderRequestsReviewWithoutChangingPaymentOrStock() {
        let user = User(id: "utente-1", email: "utente@example.test")
        let product = Catalogue.product(id: "prodotto-1")
        var order = Order(id: "ordine-1", user: user, product: product, state: .open)
        let payment = PaymentStore.payment(for: order.id)
        let stockBefore = InventoryLookup.stock(for: product.id)

        let request = CancelPaidOrder.requestReview(for: &order, payment: payment)

        XCTAssertEqual(order.state, .reviewRequested)
        XCTAssertEqual(request?.orderID, order.id)
        XCTAssertEqual(payment.status, .paid)
        XCTAssertEqual(InventoryLookup.stock(for: product.id), stockBefore)
    }
}
