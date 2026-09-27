"""Convert an OSM map API XML response to the geometry format used by the importer.

Usage: python scripts/read-osm-map.py input.osm.xml output.json
Only public way geometries/tags are retained; contributor details are omitted.
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
with open(sys.argv[2], 'w', encoding='utf-8') as output:
    json.dump({'source': 'https://api.openstreetmap.org/api/0.6/map?bbox=77.231,28.606,77.257,28.631',
               'bounds': root.find('bounds').attrib, 'elements': ways}, output, separators=(',', ':'))
print(f'Converted {len(ways)} complete ways')
