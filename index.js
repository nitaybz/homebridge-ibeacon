var Accessory, Service, Characteristic;
var Bleacon = require('bleacon');
var KalmanFilter = require('kalmanjs').default;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerPlatform("homebridge-ibeacon", "iBeacon", iBeaconPlatform);
}

function iBeaconPlatform(log, config, api) {
    this.log = log;
    this.config = config;
    this.scans = [];
    if (api) {
        this.api = api;
    }
    Bleacon.startScanning("","","", true);
    Bleacon.on('discover', function(bleacon) {
        this.log("************** Found iBeacon **************")
        this.log("UUID: " + bleacon.uuid)
        this.log("Proximity: " + bleacon.proximity)
    })
    setTimeout(function(){
        Bleacon.stopScanning()
    }, 3000)
    
    this.kalman = function(array){
        var kalmanFilter = new KalmanFilter({R: 0.003, Q: 9});
        
        //Apply kalman filter
        var dataConstantKalman = array.map(function(v) {
            return kalmanFilter.filter(v, 1);
        });
        return dataConstantKalman;
    }

    this.calculateDistance = function(rssi, txPower) {
        if (rssi == 0) {
            return -1.0; 
        }
        var ratio = rssi*1.0/txPower;
        if (ratio < 1.0) {
            return Math.pow(ratio,10);
        }
        else {
            var distance =  (0.89976)*Math.pow(ratio,7.7095) + 0.111;    
            return distance;
        }
    }
}

broadlinkPlatform.prototype = {
    accessories: function(callback) {
        var self = this;
        //For each device in cfg, create an accessory!
        var foundBeacons = this.config.beacons;
        var myAccessories = [];
        var uuids = [];
        for (var i = 0; i < foundBeacons.length; i++) {
            uuids.push(foundBeacons[i].uuid);
            var accessory = new BeaconAccessory(this.log, foundBeacons[i], self);
            myAccessories.push(accessory);
            this.log('Created ' + accessory.name + ' Accessory');    
        }
        setTimeout(function(){
            Bleacon.startScanning(uuids, "", "", false);
            self.log("Initializing scan...")
            Bleacon.on('discover', function(bleacon) {
                var scan = {
                    "uuid": bleacon.uuid,
                    "measuredPower": bleacon.measuredPower,
                    "rssi": bleacon.rssi
                }
                self.scans.push(scan)
                if (self.scans.length > 100){
                    self.scans.shift();
                }
            })
        }, 5000)

        callback(myAccessories);
    }
}

function BeaconAccessory(log, config, thisPlatform) {
    var platform = thisPlatform
    this.log = log;
    this.config = config;
    this.name = config.name;
    this.uuid = config.uuid;
    this.range = config.range;
    this.threshold = config.threshold;
    this.measuredPower = 59;
    this.occupied = false;

    this.service = new Service.OccupancySensor(this.name);
    this.service
        .getCharacteristic(Characteristic.OccupancyDetected)
        .on('get', this.getState.bind(this));

    var self = this;
    var rssiArray = []
    var kalmanArray = []
    setInterval(function(){
        for (i=0;i<platform.scans.length;i++){
            if (self.uuid == platform.scans[i].uuid){
                self.measuredPower = platform.scans[i].measuredPower;
                rssiArray.push(platform.scans[i].rssi)
                if (rssiArray.length > 20){
                    rssiArray.shift();
                }
            }
        }
        
        kalmanArray = platform.kalman(rssiArray)
        kalmanCalculated = platform.calculateDistance(parseInt(kalmanArray[kalmanArray.length - 1]), self.measuredPower)
        self.log("Estimated Distance - " + kalmanCalculated.toFixed(2))

        // if distance is bigger than range + threshold
        if (kalmanCalculated >= (self.range+self.threshold) && self.occupied){
            self.occupied = false;
            this.service.getCharacteristic(Characteristic.OccupancyDetected).updateValue(false);
        }
        // if distance is smaller than range - threshold
        if (kalmanCalculated <= (self.range-self.threshold) && !self.occupied){
            self.occupied = true;
            this.service.getCharacteristic(Characteristic.OccupancyDetected).updateValue(true);
        }
    },1000)

}

BeaconAccessory.prototype = {
    getServices: function() {
        var informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Manufacturer, 'iBeacon')
            .setCharacteristic(Characteristic.SerialNumber, this.uuid);

        return [this.service, informationService];
    },

    getState: function(callback) {
        callback(null, this.occupied)
    }
}
