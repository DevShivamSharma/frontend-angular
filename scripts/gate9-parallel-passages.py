"""Marked office-side corridor, from three overlapping 18 October photographs.

Campus s follows the office's long facade; decreasing t goes toward the boundary.
Only the marked corridor is replaced. Dimensions are photo estimates, not a survey.
"""
import bpy
import math
import json
from mathutils import Vector

START, END = -472.0, -388.0
STRIP_INNER, STRIP_OUTER = -386.6, -389.0
ROOF_INNER, ROOF_OUTER = -389.0, -395.0


def build(g):
    bpy.context.view_layer.update()
    removed = 0
    # The previous lane contained a drop-off island, transverse kerbs and street
    # furniture. Retire only local details, leaving the continuous base road below.
    for key in ('03', '05', '06', '09', '11', '12'):
        for o in list(g['collections'][key].objects):
            if o.type != 'MESH': continue
            p = o.matrix_world @ (sum((Vector(v) for v in o.bound_box), Vector()) / 8)
            s, t = .5*p.x+.8660254038*p.y, .8660254038*p.x-.5*p.y
            if not (-478 < s < -367 and -403 < t < -379): continue
            if key == '03' and o.name.startswith('SITE_GROUND'): continue
            if o in g['created']: g['created'].remove(o)
            bpy.data.objects.remove(o, do_unlink=True); removed += 1
    g['LIGHTS'][:] = [l for l in g['LIGHTS'] if not
        (-478 < l['position'][0] < -367 and -403 < l['position'][1] < -379)]
    c = bpy.data.collections.new('18 Photo parallel office passages')
    bpy.context.scene.collection.children.link(c)
    g['collections']['18'] = c; g['collection'] = c
    g['EVIDENCE'] = 'User marked aerial and WhatsApp 11.03.15/16/18 photographs, 2026-10-18; parallel corridor, dimensions estimated'
    V, mesh, beam, M = [g[k] for k in ('V', 'mesh', 'beam', 'M')]

    # Flush concrete covers the old single asphalt lane only within this corridor.
    outline = [(-478,-379),(-478,-402.7),(-379,-402.7),(-369,-395),(-368,-379)]
    mesh('SITE_GROUND_gate9 parallel passage concrete', [V(s,t,.285) for s,t in outline],
         [tuple(range(len(outline)))], M['concrete'])
    for s in range(-472,-377,7):
        for t0,t1 in ((-386.6,-380.6),(-401,-395.2)):
            beam('SITE_GROUND_gate9 parallel passage joint',V(s,t0,.288),V(s,t1,.288),.014,M['joint'],.002)

    # From the office outward: 6 m clear passage, 2.4 m planted strip,
    # 6 m shelter, 6 m clear outer passage, boundary hedge and existing wall.
    beam('G9 parallel planted median soil',V(START,-387.8,.42),V(END,-387.8,.42),2.4,M['soil'],.27)
    for t in (STRIP_INNER, STRIP_OUTER):
        beam('G9 parallel median low planter edge',V(START,t,.51),V(END,t,.51),.16,M['wall'],.45)
    for s in (START,END):
        beam('G9 parallel median planter end',V(s,STRIP_INNER,.51),V(s,STRIP_OUTER,.51),.16,M['wall'],.45)
    for i in range(105):
        s = START+.4+i*.8
        for t in (-387.2,-388.35): g['plant'](s,t,.62 if i%4 else .85)
    flower = g['mat']('parallel median small ivory flowers',(.76,.70,.42))
    for s in range(-470,-388,4):
        g['box']('G9 parallel median flower cluster',V(s,-387.4,.87),(.16,.22,.08),flower,math.pi/3)

    # One continuous barrel canopy, with repeated ribs and white supports.
    for s0 in range(int(START),int(END),6):
        vertices = [V(s,t,3.5+1.15*math.sin(math.pi*u/24))
                    for s in (s0,s0+6) for u in range(25)
                    for t in [ROOF_OUTER+6*u/24]]
        roof = mesh('G9 parallel white curved shelter roof',vertices,
                    [(k,k+1,k+26,k+25) for k in range(24)],M['cream'])
        for polygon in roof.data.polygons: polygon.use_smooth=True
    for s in range(int(START),int(END)+1,6):
        for k in range(24):
            beam('G9 parallel shelter arched rib',
                 V(s,ROOF_OUTER+6*k/24,3.5+1.15*math.sin(math.pi*k/24)),
                 V(s,ROOF_OUTER+6*(k+1)/24,3.5+1.15*math.sin(math.pi*(k+1)/24)),.065,M['white'])
        for t in (ROOF_INNER-.15,ROOF_OUTER+.15):
            beam('G9 parallel shelter white pillar',V(s,t,.285),V(s,t,3.5),.14,M['white'])
    for t in (ROOF_INNER-.15,ROOF_OUTER+.15):
        beam('G9 parallel shelter low wall',V(START,t,.83),V(END,t,.83),.24,M['wall'],1.09)
        beam('G9 parallel shelter wall coping',V(START,t,1.4),V(END,t,1.4),.32,M['ivory'],.08)
        beam('G9 parallel shelter roof edge',V(START,t,3.5),V(END,t,3.5),.1,M['white'])
    for s in range(-469,-388,7):
        g['box']('G9 parallel shelter warm diffuser',V(s,-392,4.25),(.6,.22,.035),M['light'],math.pi/3)
        g['LIGHTS'].append({'kind':'canopy','position':[s,-392,4.18]})

    # Boundary-side hedge/kerb leaves the second passage unobstructed.
    for i in range(126):
        s = -477+i*.7
        beam('G9 parallel boundary alternating kerb',V(s,-401,.38),V(s+.69,-401,.38),.24,M['yellow' if i%2 else 'black'],.19)
        g['plant'](s,-401.7,.7)
    for s in (-466,-445,-424,-403):
        g['lamp'](s,-401.7,0,1)
        g['lamp2'](s,-387.8,0,1)
    for s,t in ((-458,-383.4),(-421,-398.2)):
        g['box']('SITE_GROUND_gate9 parallel flush access cover',V(s,t,.29),(.9,.7,.006),M['wall'],math.pi/3)

    report = {'reference':'2026-10-18 marked aerial and three photographs',
        'scopeCampus':{'s':[-478,-368],'t':[-403,-379]},
        'longAxisCampusS':[START,END], 'estimatedWidthsMetres':{
            'officePassage':6,'plantingStrip':2.4,'shelter':6,'boundaryPassage':6},
        'crossSectionFromOffice':['open passage','planted strip','curved shelter','open passage','boundary hedge'],
        'roofCampusT':[ROOF_OUTER,ROOF_INNER], 'removedLocalObjects':removed,
        'openEnds':True, 'sourceOfficeAndOtherVenueGeometry':'retained'}
    (g['WORK']/'parallel-passages-layout.json').write_text(json.dumps(report,indent=2))
    print('GATE9_PARALLEL_PASSAGES',json.dumps(report))


def views(views,world):
    views['gate9-parallel-layout']={'position':world((-493,-427,110)), 'target':world((-431,-389,0)), 'label':'Gate 9 · Parallel passages layout'}
    views['gate9-parallel-office']={'position':world((-475,-383.5,1.8)), 'target':world((-421,-388,2.3)), 'label':'Gate 9 · Office passage and planted strip'}
    views['gate9-parallel-boundary']={'position':world((-479,-398,1.8)), 'target':world((-421,-395,2.2)), 'label':'Gate 9 · Outer passage beside shelter'}
    views['gate9-parallel-reverse']={'position':world((-381,-398,1.8)), 'target':world((-438,-395,2.2)), 'label':'Gate 9 · Parallel passages reverse view'}
