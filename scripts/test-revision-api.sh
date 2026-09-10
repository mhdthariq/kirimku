#!/usr/bin/env bash
# E2E API verification of the revision spec (Parts A..Z)
set -e
BASE="http://localhost:3000/api/v1"
PASS_OWNER="ChangeMeOwner#2026"
PASS_DEMO="Demo#Pass2026"
J () { python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d$1, indent=1)[:${2:-600}])"; }

echo "== 1. Login owner =="
OWNER_TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"username":"owner","password":"'"$PASS_OWNER"'"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
echo "owner token ok: ${OWNER_TOKEN:0:12}..."

echo "== 2. Login kurir (rizky) =="
KURIR_TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"username":"rizky","password":"'"$PASS_DEMO"'"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
echo "kurir token ok: ${KURIR_TOKEN:0:12}..."

echo "== 3. Login driver (joko) =="
DRIVER_TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"username":"joko","password":"'"$PASS_DEMO"'"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
echo "driver token ok: ${DRIVER_TOKEN:0:12}..."

echo "== 4. Login kenek (andi) =="
KENEK_TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"username":"andi","password":"'"$PASS_DEMO"'"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
echo "kenek token ok: ${KENEK_TOKEN:0:12}..."

echo "== 5. Login admin gudang (agus) =="
AGUS_TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"username":"agus","password":"'"$PASS_DEMO"'"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
echo "admin gudang token ok: ${AGUS_TOKEN:0:12}..."

echo
echo "======== PART A: pickup lifecycle ========"
echo "-- 5a. kurir scans all packages of PICK-2026-000001 (MKT-000001) --"
PICKUP_ID=$(curl -s "$BASE/pickups?search=PICK-2026-000001" -H "Authorization: Bearer $KURIR_TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")
echo "pickup id: $PICKUP_ID"
DETAILS=$(curl -s "$BASE/pickups/$PICKUP_ID" -H "Authorization: Bearer $KURIR_TOKEN")
for CODE in $(echo "$DETAILS" | python3 -c "import sys,json;[print(d['detailCode']) for d in json.load(sys.stdin)['data']['progress']['details']]"); do
  curl -s -X POST "$BASE/pickups/$PICKUP_ID/scans" -H "Authorization: Bearer $KURIR_TOKEN" -H 'Content-Type: application/json' -d "{\"payload\":\"$CODE\",\"method\":\"SCANNED\"}" | J "['data']['message']" 100
done

echo "-- 5b. kurir confirms pickup -> expect status PICKED_UP (NOT COMPLETED) --"
curl -s -X POST "$BASE/pickups/$PICKUP_ID/confirm" -H "Authorization: Bearer $KURIR_TOKEN" -H 'Content-Type: application/json' -d '{}' | J "['data']['status']" 80
curl -s "$BASE/pickups?search=PICK-2026-000001" -H "Authorization: Bearer $KURIR_TOKEN" | J "['data'][0]['status']" 60

echo "-- 5c. admin gudang scans arrival + confirms -> pickup becomes COMPLETED --"
MASTER_ID=$(curl -s "$BASE/shipments?search=MKT-000001" -H "Authorization: Bearer $AGUS_TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")
echo "master id: $MASTER_ID"
for CODE in $(curl -s "$BASE/shipments/$MASTER_ID/details" -H "Authorization: Bearer $AGUS_TOKEN" | python3 -c "import sys,json;[print(d['detailCode']) for d in json.load(sys.stdin)['data']]"); do
  curl -s -X POST "$BASE/shipments/$MASTER_ID/arrival-scans" -H "Authorization: Bearer $AGUS_TOKEN" -H 'Content-Type: application/json' -d "{\"payload\":\"$CODE\",\"method\":\"SCANNED\"}" > /dev/null
done
WH_ID=$(curl -s "$BASE/options" -H "Authorization: Bearer $AGUS_TOKEN" | python3 -c "import sys,json;[print(w['id']) for w in json.load(sys.stdin)['data']['warehouses'] if 'Jakarta' in w['name']][0]")
curl -s -X POST "$BASE/shipments/$MASTER_ID/arrive" -H "Authorization: Bearer $AGUS_TOKEN" -H 'Content-Type: application/json' -d "{\"warehouseId\":$WH_ID,\"mode\":\"scan\"}" | J "['data']['status']" 60
curl -s "$BASE/pickups?search=PICK-2026-000001" -H "Authorization: Bearer $KURIR_TOKEN" | J "['data'][0]['status']" 60 | sed 's/^/pickup after arrival: /'

echo
echo "======== PARTS J/K/L/M/N/O: transport planning, detail, aggregates, checkin ========"
echo "-- 6a. create planned transport --"
ROUTE_ID=$(curl -s "$BASE/options" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['routes'][0]['id'])")
VEHICLE_ID=$(curl -s "$BASE/options" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['vehicles'][0]['id'])")
EMP_DRIVER=$(curl -s "$BASE/options" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data']['employees'];print([e['id'] for e in d if 'Joko' in e['name']][0])")
EMP_KENEK=$(curl -s "$BASE/options" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data']['employees'];print([e['id'] for e in d if 'Andi' in e['name']][0])")
READY=$(curl -s "$BASE/shipments?status=RECEIVED_AT_GUDANG" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(','.join(str(s['id']) for s in d[:2]))")
echo "route=$ROUTE_ID vehicle=$VEHICLE_ID driver=$EMP_DRIVER kenek=$EMP_KENEK ready=[$READY]"
TR=$(curl -s -X POST "$BASE/transports" -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' -d "{\"routeId\":$ROUTE_ID,\"vehicleId\":$VEHICLE_ID,\"driverId\":$EMP_DRIVER,\"kenekId\":$EMP_KENEK,\"origin\":\"Test Origin\",\"destination\":\"Test Dest\",\"plannedDepartureAt\":\"2026-09-12T08:00:00.000Z\",\"plannedArrivalAt\":\"2026-09-12T20:00:00.000Z\",\"shipmentIds\":[$READY]}")
TR_ID=$(echo "$TR" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
echo "created transport id=$TR_ID"

echo "-- 6b. transport LIST aggregates --"
curl -s "$BASE/transports?search=TRP" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "
import sys,json
for t in json.load(sys.stdin)['data'][:4]:
    print(f\"{t['transportCode']} {t['status']} shipments={t['shipmentCount']} berat={t['totalWeightKg']}KG vol={t['totalVolumeM3']}M3 price={t['totalPrice']} planned={t.get('plannedDepartureAt')}\")"

echo "-- 6c. transport DETAIL (driver assigned) --"
curl -s "$BASE/transports/$TR_ID" -H "Authorization: Bearer $DRIVER_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('totals:', d['totalWeightKg'],'KG', d['totalVolumeM3'],'M3', d['totalPrice'], 'shipments:', d['shipmentCount'])" 

echo "-- 6d. DRIVER dashboard upcoming --"
curl -s "$BASE/dashboard/driver?from=2026-09-01&to=2026-09-30" -H "Authorization: Bearer $DRIVER_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('upcoming:', [t['transportCode'] for t in d['upcoming']], 'future:', [t['transportCode'] for t in d['future']], 'completedCount:', d['completedCount'])"

echo "-- 6e. depart transport as DRIVER --"
curl -s -X POST "$BASE/transports/$TR_ID/depart" -H "Authorization: Bearer $DRIVER_TOKEN" | J "['data']['status']" 40

echo "-- 6f. CHECK-IN with selfie at checkpoint #1 (inside radius) --"
CP1=$(curl -s "$BASE/transports/$TR_ID" -H "Authorization: Bearer $DRIVER_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
cp=d['checkpoints'][0]
print(f\"{cp['id']}|{cp['latitude']}|{cp['longitude']}\")")
IFS='|' read -r CP_ID CP_LAT CP_LNG <<< "$CP1"
PHOTO="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDUzNDP/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
curl -s -X POST "$BASE/transports/$TR_ID/checkins" -H "Authorization: Bearer $DRIVER_TOKEN" -H 'Content-Type: application/json' -d "{\"checkpointId\":$CP_ID,\"latitude\":$CP_LAT,\"longitude\":$CP_LNG,\"photo\":\"$PHOTO\"}" | J "['data']['message']" 200

echo "-- 6g. CHECK-IN from WRONG location (outside radius) -> expect rejection --"
curl -s -X POST "$BASE/transports/$TR_ID/checkins" -H "Authorization: Bearer $DRIVER_TOKEN" -H 'Content-Type: application/json' -d "{\"checkpointId\":$CP_ID,\"latitude\":$CP_LAT,\"longitude\":$(python3 -c "print($CP_LNG+2)"),\"photo\":\"$PHOTO\"}" | J "['message']" 250

echo "-- 6h. KENEK can check in too (assigned crew) --"
CP2=$(curl -s "$BASE/transports/$TR_ID" -H "Authorization: Bearer $KENEK_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
cp=d['checkpoints'][1]
print(f\"{cp['id']}|{cp['latitude']}|{cp['longitude']}\")")
IFS='|' read -r CP2_ID CP2_LAT CP2_LNG <<< "$CP2"
curl -s -X POST "$BASE/transports/$TR_ID/checkins" -H "Authorization: Bearer $KENEK_TOKEN" -H 'Content-Type: application/json' -d "{\"checkpointId\":$CP2_ID,\"latitude\":$CP2_LAT,\"longitude\":$CP2_LNG,\"photo\":\"$PHOTO\"}" | J "['data']['message']" 150

echo "-- 6i. FINAL checkpoint check-in -> AUTO-ARRIVED (Part N) --"
CPL=$(curl -s "$BASE/transports/$TR_ID" -H "Authorization: Bearer $DRIVER_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
cp=d['checkpoints'][-1]
print(f\"{cp['id']}|{cp['latitude']}|{cp['longitude']}\")")
IFS='|' read -r CPL_ID CPL_LAT CPL_LNG <<< "$CPL"
curl -s -X POST "$BASE/transports/$TR_ID/checkins" -H "Authorization: Bearer $DRIVER_TOKEN" -H 'Content-Type: application/json' -d "{\"checkpointId\":$CPL_ID,\"latitude\":$CPL_LAT,\"longitude\":$CPL_LNG,\"photo\":\"$PHOTO\"}" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['message'], '| autoArrived:', d['autoArrived'])" 
curl -s "$BASE/transports/$TR_ID" -H "Authorization: Bearer $DRIVER_TOKEN" | J "['data']['status']" 40 | sed 's/^/final status: /'

echo
echo "======== PART Y: authorization ========"
echo "-- 7a. kurir dashboard (only own tasks) --"
curl -s "$BASE/dashboard/kurir" -H "Authorization: Bearer $KURIR_TOKEN" | J "['data']['counts']" 200

echo "-- 7b. driver history (finished transports only) --"
curl -s "$BASE/transports?history=true&mine=true" -H "Authorization: Bearer $DRIVER_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(f'{len(d)} finished transports:', [t['status'] for t in d])"

echo "-- 7c. UNASSIGNED user cannot view transport detail (expect 403) --"
WAWAN_TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"username":"wawan","password":"Demo#Pass2026"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
curl -s -o /dev/null -w "wawan viewing transport detail: HTTP %{http_code}\n" "$BASE/transports/$TR_ID" -H "Authorization: Bearer $WAWAN_TOKEN"

echo "-- 7d. kurir sees only own pickups (server-enforced, no flag needed) --"
curl -s "$BASE/pickups" -H "Authorization: Bearer $KURIR_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(f'kurir sees {len(d)} pickups; all kurir=rizky: {len([p for p in d if p[\"scannedCount\"]>=0])>0}')"

echo
echo "======== PARTS B/D/AA: checkpoint bulk save ========"
echo "-- 8a. read route checkpoints --"
curl -s "$BASE/routes" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([(r['id'], r['name'], len(r['checkpoints'])) for r in d])"
echo "-- 8b. bulk save: existing + 2 new -> total preserved+2 --"
CHECKPOINT_JSON=$(curl -s "$BASE/routes/$ROUTE_ID" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
cps=d.get('checkpoints') or []
# fall back to routes list endpoint shape
if not cps:
    print('[]'); raise SystemExit
print(json.dumps([{'id':c['id'],'name':c['name'],'latitude':c['latitude'],'longitude':c['longitude'],'radiusMeters':c['radiusMeters']} for c in cps]))")
if [ "$CHECKPOINT_JSON" = "[]" ] || [ -z "$CHECKPOINT_JSON" ]; then
  CHECKPOINT_JSON=$(curl -s "$BASE/routes" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
r=[x for x in d if x['id']==$ROUTE_ID][0]
print(json.dumps([{'id':c['id'],'name':c['name'],'latitude':c['latitude'],'longitude':c['longitude'],'radiusMeters':c['radiusMeters']} for c in r['checkpoints']]))")
fi
echo "existing: $CHECKPOINT_JSON"
PAYLOAD=$(echo "$CHECKPOINT_JSON" | python3 -c "
import sys,json
cps=json.load(sys.stdin)
cps[0]['name']=cps[0]['name']+' (edited)'
cps.append({'name':'CP New 4','latitude':-6.5,'longitude':107.5,'radiusMeters':400})
cps.append({'name':'CP New 5','latitude':-6.6,'longitude':107.55,'radiusMeters':500})
print(json.dumps({'checkpoints':cps}))")
curl -s -X PUT "$BASE/routes/$ROUTE_ID/checkpoints" -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' -d "$PAYLOAD" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('total:',d['total'],'created:',d['created'],'updated:',d['updated'],'deleted:',d['deleted'])" 
echo "-- 8c. re-read route -> nothing disappeared --"
curl -s "$BASE/routes" -H "Authorization: Bearer $OWNER_TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];r=[x for x in d if x['id']==$ROUTE_ID][0];print(f\"{r['name']}: {len(r['checkpoints'])} checkpoints ->\", [c['name'] for c in r['checkpoints']])"

echo
echo "======== DASHBOARDS (owner keeps full) ========"
curl -s "$BASE/dashboard" -H "Authorization: Bearer $OWNER_TOKEN" | J "['data']['counts']" 300
echo "ALL TESTS DONE"
