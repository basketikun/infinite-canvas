/**
 * Asset catalog — engine-side metadata for every built-in library item.
 * The renderer maps each id to a procedural grey-box builder; the engine
 * needs heights (auto-framing), speed scales (sanity checks), and category
 * info (library UI, prompts).
 */

import type { EntityCategory } from './types'

export type Motion = 'biped' | 'quadruped' | 'wheeled' | 'rail' | 'flying' | 'static'

export interface AssetSpec {
  id: string
  name: string
  category: EntityCategory
  /** Standing height in meters (drives auto-framing and label placement). */
  height: number
  /** Rough footprint radius in meters (placement, top-down diagram). */
  footprint: number
  /** Multiplies plausible gait speeds (vehicles travel faster than people). */
  speedScale: number
  motion: Motion
  /** Word used in generated prompts, e.g. 'a man', 'an SUV'. */
  promptNoun: string
}

const A = (
  id: string,
  name: string,
  category: EntityCategory,
  height: number,
  footprint: number,
  speedScale: number,
  motion: Motion,
  promptNoun: string
): AssetSpec => ({ id, name, category, height, footprint, speedScale, motion, promptNoun })

export const ASSET_CATALOG: AssetSpec[] = [
  // People — heights adjustable per-entity via params.height
  A('person.man', 'Man', 'people', 1.78, 0.3, 1, 'biped', 'a man'),
  A('person.woman', 'Woman', 'people', 1.65, 0.28, 1, 'biped', 'a woman'),
  A('person.child', 'Child', 'people', 1.2, 0.22, 0.8, 'biped', 'a child'),
  A('person.elderly', 'Elderly person', 'people', 1.68, 0.3, 0.6, 'biped', 'an elderly person'),

  // Animals
  A('animal.dog', 'Dog', 'animals', 0.6, 0.35, 1.8, 'quadruped', 'a dog'),
  A('animal.cat', 'Cat', 'animals', 0.28, 0.2, 1.2, 'quadruped', 'a cat'),
  A('animal.horse', 'Horse', 'animals', 1.65, 0.7, 4.5, 'quadruped', 'a horse'),
  A('animal.bird', 'Bird', 'animals', 0.25, 0.15, 3, 'flying', 'a bird'),

  // Vehicles
  A('vehicle.sedan', 'Sedan', 'vehicles', 1.45, 2.4, 15, 'wheeled', 'a sedan car'),
  A('vehicle.suv', 'SUV', 'vehicles', 1.8, 2.5, 15, 'wheeled', 'an SUV'),
  A('vehicle.pickup', 'Pickup truck', 'vehicles', 1.9, 2.7, 14, 'wheeled', 'a pickup truck'),
  A('vehicle.van', 'Van', 'vehicles', 2.2, 2.6, 13, 'wheeled', 'a van'),
  A('vehicle.bus', 'Bus', 'vehicles', 3.2, 6.0, 11, 'wheeled', 'a city bus'),
  A('vehicle.truck', 'Semi truck', 'vehicles', 3.8, 8.0, 12, 'wheeled', 'a semi truck'),
  A('vehicle.tank', 'Tank', 'vehicles', 2.4, 4.0, 8, 'wheeled', 'a military tank'),
  A('vehicle.train', 'Train car', 'vehicles', 3.6, 12.0, 20, 'rail', 'a train'),
  A('vehicle.motorcycle', 'Motorcycle', 'vehicles', 1.3, 1.1, 16, 'wheeled', 'a motorcycle'),
  A('vehicle.bicycle', 'Bicycle', 'vehicles', 1.1, 0.9, 5, 'wheeled', 'a bicycle'),
  A('vehicle.plane', 'Airplane', 'vehicles', 5.5, 15.0, 60, 'flying', 'an airplane'),
  A('vehicle.boat', 'Boat', 'vehicles', 2.0, 4.0, 10, 'wheeled', 'a boat'),

  // Furniture & props
  A('furniture.bed', 'Bed', 'furniture', 0.6, 1.1, 0, 'static', 'a bed'),
  A('furniture.couch', 'Couch', 'furniture', 0.85, 1.2, 0, 'static', 'a couch'),
  A('furniture.armchair', 'Armchair', 'furniture', 0.9, 0.55, 0, 'static', 'an armchair'),
  A('furniture.diningTable', 'Dining table', 'furniture', 0.76, 1.0, 0, 'static', 'a dining table'),
  A('furniture.kitchenTable', 'Kitchen table', 'furniture', 0.9, 0.8, 0, 'static', 'a kitchen table'),
  A('furniture.desk', 'Desk', 'furniture', 0.75, 0.8, 0, 'static', 'a desk'),
  A('furniture.sideTable', 'Side table', 'furniture', 0.55, 0.3, 0, 'static', 'a side table'),
  A('furniture.lamp', 'Floor lamp', 'furniture', 1.6, 0.2, 0, 'static', 'a floor lamp'),
  A('furniture.chair', 'Chair', 'furniture', 0.9, 0.3, 0, 'static', 'a chair'),
  A('furniture.stool', 'Stool', 'furniture', 0.65, 0.2, 0, 'static', 'a stool'),
  A('furniture.bar', 'Bar counter', 'furniture', 1.1, 1.5, 0, 'static', 'a bar counter'),
  A('furniture.counter', 'Kitchen counter', 'furniture', 0.95, 1.2, 0, 'static', 'a kitchen counter'),
  A('furniture.shelf', 'Shelf unit', 'furniture', 1.9, 0.5, 0, 'static', 'a shelf'),
  A('furniture.tv', 'TV', 'furniture', 0.75, 0.6, 0, 'static', 'a television'),
  A('furniture.tableSetting', 'Table setting', 'furniture', 0.12, 0.25, 0, 'static', 'plates and glasses'),
  A('furniture.door', 'Door', 'furniture', 2.1, 0.5, 0, 'static', 'a door'),
  A('furniture.window', 'Window', 'furniture', 1.4, 0.6, 0, 'static', 'a window'),
  A('furniture.fridge', 'Fridge', 'furniture', 1.8, 0.4, 0, 'static', 'a refrigerator'),
  A('furniture.stove', 'Stove', 'furniture', 0.9, 0.4, 0, 'static', 'a kitchen stove'),
  A('furniture.sinkCounter', 'Sink counter', 'furniture', 0.9, 0.6, 0, 'static', 'a sink counter'),
  A('furniture.toilet', 'Toilet', 'furniture', 0.75, 0.35, 0, 'static', 'a toilet'),
  A('furniture.bathtub', 'Bathtub', 'furniture', 0.6, 0.9, 0, 'static', 'a bathtub'),
  A('furniture.showerStall', 'Shower stall', 'furniture', 2.1, 0.6, 0, 'static', 'a shower stall'),
  A('furniture.officeChair', 'Office chair', 'furniture', 1.1, 0.35, 0, 'static', 'an office chair'),
  A('furniture.filingCabinet', 'Filing cabinet', 'furniture', 1.3, 0.35, 0, 'static', 'a filing cabinet'),
  A('furniture.whiteboard', 'Whiteboard', 'furniture', 1.8, 0.6, 0, 'static', 'a whiteboard'),
  A('furniture.podium', 'Podium', 'furniture', 1.15, 0.35, 0, 'static', 'a podium'),
  A('furniture.monitor', 'Monitor', 'furniture', 0.55, 0.25, 0, 'static', 'a computer monitor'),
  A('furniture.pianoUpright', 'Upright piano', 'furniture', 1.25, 0.8, 0, 'static', 'an upright piano'),
  A('furniture.poolTable', 'Pool table', 'furniture', 0.8, 1.6, 0, 'static', 'a pool table'),
  A('furniture.hospitalBed', 'Hospital bed', 'furniture', 0.9, 1.1, 0, 'static', 'a hospital bed'),
  A('furniture.wheelchair', 'Wheelchair', 'furniture', 1.0, 0.5, 0, 'static', 'a wheelchair'),
  A('furniture.crib', 'Crib', 'furniture', 1.0, 0.7, 0, 'static', 'a crib'),
  A('furniture.fireplace', 'Fireplace', 'furniture', 1.4, 0.6, 0, 'static', 'a fireplace'),
  A('furniture.chandelier', 'Chandelier', 'furniture', 2.7, 0.5, 0, 'static', 'a chandelier'),
  A('furniture.rug', 'Rug', 'furniture', 0.02, 1.8, 0, 'static', 'a rug'),
  A('furniture.curtain', 'Curtain', 'furniture', 2.4, 0.3, 0, 'static', 'a curtain'),
  A('furniture.bookshelfFull', 'Bookshelf', 'furniture', 1.9, 0.5, 0, 'static', 'a bookshelf full of books'),
  A('furniture.doorOpen', 'Open door', 'furniture', 2.1, 0.9, 0, 'static', 'an open door'),

  // Props — hand/table scale and outdoor/set dressing
  A('prop.phone', 'Phone', 'props', 0.15, 0.05, 0, 'static', 'a cell phone'),
  A('prop.laptop', 'Laptop', 'props', 0.25, 0.2, 0, 'static', 'a laptop'),
  A('prop.cup', 'Cup', 'props', 0.1, 0.05, 0, 'static', 'a cup'),
  A('prop.mug', 'Mug', 'props', 0.1, 0.06, 0, 'static', 'a coffee mug'),
  A('prop.bowl', 'Bowl', 'props', 0.08, 0.08, 0, 'static', 'a bowl'),
  A('prop.plate', 'Plate', 'props', 0.03, 0.13, 0, 'static', 'a plate'),
  A('prop.bottle', 'Bottle', 'props', 0.3, 0.04, 0, 'static', 'a bottle'),
  A('prop.wineglass', 'Wine glass', 'props', 0.2, 0.05, 0, 'static', 'a wine glass'),
  A('prop.book', 'Book', 'props', 0.22, 0.12, 0, 'static', 'a book'),
  A('prop.newspaper', 'Newspaper', 'props', 0.02, 0.25, 0, 'static', 'a newspaper'),
  A('prop.briefcase', 'Briefcase', 'props', 0.35, 0.25, 0, 'static', 'a briefcase'),
  A('prop.suitcase', 'Suitcase', 'props', 0.7, 0.3, 0, 'static', 'a suitcase'),
  A('prop.backpack', 'Backpack', 'props', 0.5, 0.2, 0, 'static', 'a backpack'),
  A('prop.umbrella', 'Umbrella', 'props', 0.9, 0.08, 0, 'static', 'a closed umbrella'),
  A('prop.hat', 'Hat', 'props', 0.15, 0.2, 0, 'static', 'a fedora hat'),
  A('prop.baseballBat', 'Baseball bat', 'props', 0.9, 0.06, 0, 'static', 'a baseball bat'),
  A('prop.sword', 'Sword', 'props', 1.0, 0.1, 0, 'static', 'a sword'),
  A('prop.torch', 'Flashlight', 'props', 0.2, 0.04, 0, 'static', 'a flashlight'),
  A('prop.candle', 'Candle', 'props', 0.15, 0.03, 0, 'static', 'a candle'),
  A('prop.lantern', 'Lantern', 'props', 0.3, 0.1, 0, 'static', 'a lantern'),
  A('prop.pictureFrame', 'Picture frame', 'props', 0.4, 0.05, 0, 'static', 'a picture frame'),
  A('prop.poster', 'Poster', 'props', 0.9, 0.03, 0, 'static', 'a poster'),
  A('prop.mirror', 'Mirror', 'props', 1.0, 0.05, 0, 'static', 'a mirror'),
  A('prop.clock', 'Clock', 'props', 0.4, 0.05, 0, 'static', 'a wall clock'),
  A('prop.ball', 'Ball', 'props', 0.22, 0.11, 0, 'static', 'a ball'),
  A('prop.balloon', 'Balloon', 'props', 0.4, 0.15, 0, 'static', 'a balloon'),
  A('prop.microphone', 'Microphone', 'props', 1.5, 0.25, 0, 'static', 'a microphone on a stand'),
  A('prop.guitar', 'Guitar', 'props', 1.0, 0.2, 0, 'static', 'a guitar'),
  A('prop.camera', 'Film camera', 'props', 0.3, 0.2, 0, 'static', 'a handheld film camera'),
  A('prop.tripod', 'Tripod', 'props', 1.5, 0.4, 0, 'static', 'a tripod'),
  A('prop.tree', 'Tree', 'props', 3.5, 1.5, 0, 'static', 'a tree'),
  A('prop.bush', 'Bush', 'props', 0.8, 0.7, 0, 'static', 'a bush'),
  A('prop.rock', 'Rock', 'props', 0.8, 0.7, 0, 'static', 'a rock'),
  A('prop.streetlightSingle', 'Streetlight', 'props', 4.0, 0.3, 0, 'static', 'a streetlight'),
  A('prop.trafficLight', 'Traffic light', 'props', 3.0, 0.3, 0, 'static', 'a traffic light'),
  A('prop.stopSign', 'Stop sign', 'props', 2.1, 0.2, 0, 'static', 'a stop sign'),
  A('prop.fireHydrant', 'Fire hydrant', 'props', 0.8, 0.2, 0, 'static', 'a fire hydrant'),
  A('prop.mailbox', 'Mailbox', 'props', 1.1, 0.3, 0, 'static', 'a mailbox'),
  A('prop.trashcan', 'Trash can', 'props', 0.9, 0.3, 0, 'static', 'a trash can'),
  A('prop.dumpster', 'Dumpster', 'props', 1.3, 1.0, 0, 'static', 'a dumpster'),
  A('prop.trafficCone', 'Traffic cone', 'props', 0.5, 0.15, 0, 'static', 'a traffic cone'),
  A('prop.barrier', 'Barrier', 'props', 1.1, 1.0, 0, 'static', 'a roadwork barrier'),
  A('prop.fence', 'Fence', 'props', 2.0, 1.2, 0, 'static', 'a fence'),
  A('prop.bench', 'Park bench', 'props', 0.8, 0.9, 0, 'static', 'a park bench'),
  A('prop.phoneBooth', 'Phone booth', 'props', 2.4, 0.5, 0, 'static', 'a phone booth'),
  A('prop.atm', 'ATM', 'props', 1.6, 0.4, 0, 'static', 'an ATM'),
  A('prop.vendingMachine', 'Vending machine', 'props', 1.9, 0.5, 0, 'static', 'a vending machine'),
  A('prop.shoppingCart', 'Shopping cart', 'props', 1.0, 0.5, 0, 'static', 'a shopping cart'),
  A('prop.ladder', 'Ladder', 'props', 2.4, 0.6, 0, 'static', 'a ladder'),
  A('prop.scaffold', 'Scaffold', 'props', 4.0, 1.5, 0, 'static', 'a scaffold'),
  A('prop.crate', 'Crate', 'props', 0.8, 0.6, 0, 'static', 'a wooden crate'),
  A('prop.barrel', 'Barrel', 'props', 0.9, 0.35, 0, 'static', 'a barrel'),
  A('prop.pallet', 'Pallet', 'props', 0.15, 0.7, 0, 'static', 'a wooden pallet'),
  A('prop.tent', 'Tent', 'props', 1.4, 1.3, 0, 'static', 'a camping tent'),
  A('prop.campfire', 'Campfire', 'props', 0.5, 0.5, 0, 'static', 'a campfire'),
  A('prop.poolWater', 'Pool of water', 'props', 0.05, 1.8, 0, 'static', 'a pool of water'),
  A('prop.fountain', 'Fountain', 'props', 1.6, 1.2, 0, 'static', 'a fountain'),
  A('prop.flagpole', 'Flagpole', 'props', 6.0, 0.3, 0, 'static', 'a flagpole'),
  A('prop.helicopter', 'Helicopter', 'props', 3.5, 6.0, 30, 'flying', 'a helicopter'),

  // Props — backyard / recreation
  A('prop.hotTub', 'Hot Tub', 'props', 0.9, 1.1, 0, 'static', 'a hot tub'),
  A('prop.bbqGrill', 'BBQ Grill', 'props', 1.1, 0.6, 0, 'static', 'a barbecue grill'),
  A('prop.firepit', 'Fire Pit', 'props', 0.6, 0.7, 0, 'static', 'a fire pit'),
  A('prop.poolLounger', 'Pool Lounger', 'props', 0.6, 0.9, 0, 'static', 'a pool lounge chair'),
  A('prop.patioUmbrellaTable', 'Patio Umbrella Table', 'props', 2.4, 1.0, 0, 'static', 'a patio table with umbrella'),
  A('prop.picnicTable', 'Picnic Table', 'props', 0.8, 1.2, 0, 'static', 'a picnic table'),
  A('prop.swingSet', 'Swing Set', 'props', 2.4, 1.6, 0, 'static', 'a swing set'),
  A('prop.slide', 'Playground Slide', 'props', 2.2, 1.4, 0, 'static', 'a playground slide'),
  A('prop.seesaw', 'Seesaw', 'props', 1.0, 1.6, 0, 'static', 'a seesaw'),
  A('prop.sandbox', 'Sandbox', 'props', 0.3, 1.2, 0, 'static', 'a sandbox'),
  A('prop.trampoline', 'Trampoline', 'props', 2.4, 1.8, 0, 'static', 'a trampoline'),
  A('prop.kiddiePool', 'Kiddie Pool', 'props', 0.3, 0.9, 0, 'static', 'a kiddie pool'),
  A('prop.basketballHoop', 'Basketball Hoop', 'props', 3.05, 0.6, 0, 'static', 'a basketball hoop'),
  A('prop.soccerGoal', 'Soccer Goal', 'props', 2.44, 3.7, 0, 'static', 'a soccer goal'),
  A('prop.doghouse', 'Doghouse', 'props', 0.9, 0.6, 0, 'static', 'a doghouse'),
  A('prop.shed', 'Garden Shed', 'props', 2.3, 1.5, 0, 'static', 'a garden shed'),
  A('prop.gazebo', 'Gazebo', 'props', 3.0, 2.0, 0, 'static', 'a gazebo'),
  A('prop.hammock', 'Hammock', 'props', 1.2, 1.6, 0, 'static', 'a hammock'),
  A('prop.lawnmower', 'Lawnmower', 'props', 1.0, 0.6, 0, 'static', 'a lawnmower'),

  // Props — commercial / street
  A('prop.cashRegister', 'Cash Register', 'props', 0.35, 0.3, 0, 'static', 'a cash register'),
  A('prop.kiosk', 'Kiosk', 'props', 2.6, 1.0, 0, 'static', 'a vendor kiosk'),
  A('prop.gasPump', 'Gas Pump', 'props', 1.5, 0.4, 0, 'static', 'a gas pump'),
  A('prop.parkingMeter', 'Parking Meter', 'props', 1.3, 0.15, 0, 'static', 'a parking meter'),
  A('prop.busShelter', 'Bus Shelter', 'props', 2.4, 2.0, 0, 'static', 'a bus shelter'),
  A('prop.slotMachine', 'Slot Machine', 'props', 1.7, 0.35, 0, 'static', 'a slot machine'),
  A('prop.cloud', 'Cloud', 'props', 2.5, 1.6, 0, 'flying', 'a cloud'),
  A('prop.squirtGun', 'Squirt Gun (Toy)', 'props', 0.35, 0.2, 0, 'static', 'a toy squirt gun'),

  // Environment kits (one-click shells; placed like entities, big footprint)
  A('env.houseInterior', 'House interior', 'environment', 2.7, 6, 0, 'static', 'a house interior'),
  A('env.houseExterior', 'House exterior', 'environment', 6, 8, 0, 'static', 'a suburban house exterior'),
  A('env.cityStreet', 'City street', 'environment', 12, 20, 0, 'static', 'a city street'),
  A('env.store', 'Store', 'environment', 3.5, 10, 0, 'static', 'a store interior'),
  A('env.nightclub', 'Nightclub', 'environment', 4, 10, 0, 'static', 'a nightclub interior'),
  A('env.office', 'Office', 'environment', 2.8, 8, 0, 'static', 'an office interior'),
  A('env.warehouse', 'Warehouse', 'environment', 6, 12, 0, 'static', 'a warehouse interior'),
  A('env.carInterior', 'Car interior', 'environment', 1.3, 1.5, 0, 'static', 'a car interior'),
  A('env.busInterior', 'Bus interior', 'environment', 2.2, 5, 0, 'static', 'a bus interior'),
  A('env.planeCabin', 'Plane cabin', 'environment', 2.2, 6, 0, 'static', 'an airplane cabin'),
  A('env.field', 'Open field', 'environment', 0.1, 30, 0, 'static', 'an open field'),
  A('env.desert', 'Desert', 'environment', 0.1, 30, 0, 'static', 'a desert'),
  A('env.parkingLot', 'Parking lot', 'environment', 0.1, 15, 0, 'static', 'a parking lot'),
  A('env.alley', 'Alley', 'environment', 8, 8, 0, 'static', 'an alley'),
  A('env.rooftop', 'Rooftop', 'environment', 1.2, 12, 0, 'static', 'a rooftop'),
  A('env.restaurant', 'Restaurant', 'environment', 3, 12, 0, 'static', 'a restaurant interior'),
  A('env.hospitalRoom', 'Hospital room', 'environment', 2.8, 8, 0, 'static', 'a hospital room'),
  A('env.classroom', 'Classroom', 'environment', 2.8, 10, 0, 'static', 'a classroom'),
  A('env.gym', 'Gym', 'environment', 3.5, 12, 0, 'static', 'a gym interior'),
  A('env.courtroom', 'Courtroom', 'environment', 4, 12, 0, 'static', 'a courtroom'),
  A('env.subwayPlatform', 'Subway platform', 'environment', 4, 15, 0, 'static', 'a subway platform'),
  A('env.beach', 'Beach', 'environment', 0.1, 30, 0, 'static', 'a beach'),
  A('env.forest', 'Forest', 'environment', 5, 30, 0, 'static', 'a forest'),
  A('env.bar', 'Bar', 'environment', 3, 12, 0, 'static', 'a bar interior'),
  A('env.stage', 'Stage', 'environment', 5, 14, 0, 'static', 'a stage'),

  // Environment kits — round 5 interiors
  A('env.trainInterior', 'Train Car Interior', 'environment', 2.4, 8, 0, 'static', 'a train car interior'),
  A('env.boatInterior', 'Boat Cabin', 'environment', 2.2, 6, 0, 'static', 'a boat cabin interior'),
  A('env.postOffice', 'Post Office', 'environment', 3, 8, 0, 'static', 'a post office interior'),
  A('env.supermarket', 'Supermarket', 'environment', 4, 12, 0, 'static', 'a supermarket interior'),
  A('env.movieTheater', 'Movie Theater', 'environment', 5, 12, 0, 'static', 'a movie theater interior'),
  A('env.indoorMall', 'Indoor Mall', 'environment', 6, 16, 0, 'static', 'an indoor shopping mall'),
  A('env.hotelLobby', 'Hotel Lobby', 'environment', 4, 12, 0, 'static', 'a hotel lobby'),
  A('env.hotelRoom', 'Hotel Room', 'environment', 2.7, 8, 0, 'static', 'a hotel room'),
  A('env.diner', 'Diner', 'environment', 3, 10, 0, 'static', 'a diner interior'),
  A('env.coffeeShop', 'Coffee Shop', 'environment', 3, 10, 0, 'static', 'a coffee shop interior'),
  A('env.policeStation', 'Police Station', 'environment', 3, 12, 0, 'static', 'a police station interior'),
  A('env.church', 'Church', 'environment', 6, 12, 0, 'static', 'a church interior'),
  A('env.schoolHallway', 'School Hallway', 'environment', 3, 10, 0, 'static', 'a school hallway'),
  A('env.airportTerminal', 'Airport Terminal', 'environment', 5, 16, 0, 'static', 'an airport terminal'),
  A('env.casino', 'Casino', 'environment', 3.5, 12, 0, 'static', 'a casino interior'),
  A('env.parkingGarage', 'Parking Garage', 'environment', 2.6, 14, 0, 'static', 'a parking garage'),

  // Environment kits — round 5 exteriors
  A('env.stripMall', 'Strip Mall', 'environment', 5, 20, 0, 'static', 'a strip mall'),
  A('env.outdoorMall', 'Outdoor Mall', 'environment', 5, 20, 0, 'static', 'an outdoor pedestrian mall'),
  A('env.residentialStreet', 'Residential Street', 'environment', 5, 24, 0, 'static', 'a residential street'),
  A('env.downtown', 'Downtown', 'environment', 14, 24, 0, 'static', 'a downtown city street'),
  A('env.trainStation', 'Train Station Platform', 'environment', 4, 20, 0, 'static', 'a train station platform'),
  A('env.gasStation', 'Gas Station', 'environment', 5, 16, 0, 'static', 'a gas station'),
  A('env.park', 'City Park', 'environment', 4, 24, 0, 'static', 'a city park'),
  A('env.playgroundPark', 'Playground', 'environment', 3, 18, 0, 'static', 'a playground'),
  A('env.backyard', 'Backyard w/ Pool', 'environment', 3, 18, 0, 'static', 'a backyard with a pool'),
  A('env.constructionSite', 'Construction Site', 'environment', 6, 20, 0, 'static', 'a construction site'),
  A('env.cemetery', 'Cemetery', 'environment', 4, 20, 0, 'static', 'a cemetery'),
  A('env.stadium', 'Stadium Section', 'environment', 8, 24, 0, 'static', 'a stadium section'),
  A('env.sky', 'Sky (Aerial)', 'environment', 0.1, 40, 0, 'static', 'an open sky'),
  A('env.houseFull', 'House Interior (Rooms)', 'environment', 2.4, 10, 0, 'static', 'a full house interior with rooms'),

  // Primitives
  A('prim.cube', 'Cube', 'primitives', 1, 0.5, 0, 'static', 'a box'),
  A('prim.cylinder', 'Cylinder', 'primitives', 1, 0.5, 0, 'static', 'a cylinder'),
  A('prim.ramp', 'Ramp', 'primitives', 1, 1, 0, 'static', 'a ramp'),
  A('prim.wall', 'Wall segment', 'primitives', 2.7, 1.5, 0, 'static', 'a wall'),
  A('prim.stairs', 'Stairs', 'primitives', 2, 1, 0, 'static', 'stairs')
]

const byId = new Map(ASSET_CATALOG.map((a) => [a.id, a]))

export function assetSpec(assetId: string): AssetSpec {
  const spec = byId.get(assetId)
  if (spec) return spec
  // Custom imports and unknown ids degrade gracefully to a person-scale box.
  return {
    id: assetId,
    name: assetId.split('.').pop() ?? assetId,
    category: 'custom',
    height: 1.7,
    footprint: 0.5,
    speedScale: 1,
    motion: 'static',
    promptNoun: 'an object'
  }
}

/** World-space height of an entity (asset height × entity scale × height param). */
export function entityHeight(assetId: string, scale: number, params?: Record<string, number | string>): number {
  const spec = assetSpec(assetId)
  const heightParam = typeof params?.height === 'number' ? params.height : 1
  return spec.height * scale * heightParam
}
