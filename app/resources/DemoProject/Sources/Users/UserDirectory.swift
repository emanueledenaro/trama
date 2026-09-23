import Foundation

public enum UserDirectory {
    public static func displayName(for user: User) -> String {
        user.email.split(separator: "@").first.map(String.init) ?? user.id
    }
}
