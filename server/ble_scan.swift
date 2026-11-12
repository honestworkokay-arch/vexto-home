import CoreBluetooth
import Darwin
import Foundation

final class Scan: NSObject, CBCentralManagerDelegate {
    let seconds: Double
    var central: CBCentralManager?

    init(seconds: Double) {
        self.seconds = seconds
        super.init()
    }

    func start() {
        central = CBCentralManager(delegate: self, queue: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            exit(0)
        }
    }

    func emit(_ fields: [String: String]) {
        let body = fields.map { key, value in
            "\"\(key)\":\"\(value)\""
        }.joined(separator: ",")
        print("{\(body)}")
        fflush(stdout)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        emit(["event": "state", "code": String(central.state.rawValue)])
        if central.state == .poweredOn {
            central.scanForPeripherals(
                withServices: nil,
                options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
            )
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        if let manufacturer = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
            let hex = manufacturer.map { String(format: "%02x", $0) }.joined()
            let xiaomi = hex.hasPrefix("8f03") || hex.contains("95fe") || hex.contains("474c") || hex.contains("8b09") || hex.contains("ec24e838c1a4") || hex.contains("a4c138e824ec")
            if xiaomi {
                emit(["event": "mfg", "rssi": RSSI.stringValue, "hex": hex])
            }
        }
        if let list = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] {
            let uuids = list.map { $0.uuidString.uppercased() }.joined(separator: "|")
            if uuids.contains("FE95") {
                emit(["event": "uuid", "rssi": RSSI.stringValue, "uuids": uuids])
            }
        }
        if let services = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] {
            for (uuid, data) in services {
                let token = uuid.uuidString.uppercased()
                if token != "FE95" && !token.hasPrefix("0000FE95") {
                    continue
                }
                emit([
                    "event": "adv",
                    "rssi": RSSI.stringValue,
                    "hex": data.map { String(format: "%02x", $0) }.joined(),
                ])
            }
        }
    }
}

let seconds = min(20.0, max(3.0, Double(CommandLine.arguments.dropFirst().first ?? "") ?? 10))
let scan = Scan(seconds: seconds)
scan.start()
dispatchMain()
