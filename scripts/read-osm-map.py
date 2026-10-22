"""Convert an OSM map API XML response to the geometry format used by the importer.

Usage: python scripts/read-osm-map.py input.osm.xml output.json
Only public way geometries/tags are retained; contributor details are omitted.
Multipolygon relations (the Supreme Court, the Income Tax Office, ...) become one element per closed outer way,
carrying the relation's tags and its closed inner ways as `holes`, unless that outer way is already tagged itself.
"""
import json
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
nodes = {node.attrib['id']: {'lat': float(node.attrib['lat']), 'lon': float(node.attrib['lon'])}
         for node in root.findall('node')}
ways = []
for way in root.findall('way'):
    tags = {tag.attrib['k']: tag.attrib['v'] for tag in way.findall('tag')}
    geometry = [nodes.get(nd.attrib['ref']) for nd in way.findall('nd')]
    if all(geometry):
        ways.append({'id': int(way.attrib['id']), 'tags': tags, 'geometry': geometry})
by_id = {way['id']: way for way in ways}
closed = lambda way: way is not None and len(way['geometry']) >= 4 and way['geometry'][0] == way['geometry'][-1]
relations = 0
for relation in root.findall('relation'):
    tags = {tag.attrib['k']: tag.attrib['v'] for tag in relation.findall('tag')}
    if tags.pop('type', None) != 'multipolygon':
        continue
    members = [(m.attrib['role'], by_id.get(int(m.attrib['ref']))) for m in relation.findall('member') if m.attrib['type'] == 'way']
    holes = [way['geometry'] for role, way in members if role == 'inner' and closed(way)]
    for role, way in members:
        if role == 'outer' and closed(way) and not way['tags']:
            ways.append({'id': int(relation.attrib['id']), 'relation': True, 'tags': tags, 'geometry': way['geometry'], 'holes': holes})
            relations += 1
with open(sys.argv[2], 'w', encoding='utf-8') as output:
    json.dump({'source': 'https://api.openstreetmap.org/api/0.6/map?bbox=77.231,28.606,77.257,28.631',
               'bounds': root.find('bounds').attrib, 'elements': ways}, output, separators=(',', ':'))
print(f'Converted {len(ways)} complete ways, {relations} of them multipolygon outers')
