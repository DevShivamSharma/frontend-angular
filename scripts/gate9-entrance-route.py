"""Local entrance correction from the 18 October front/reverse/route photographs.

Dimensions are estimates. The existing office, long passages and shelters remain.
"""
import bpy
import math
import random


def build(g):
    c=bpy.data.collections.new('19 Photo entrance route')
    bpy.context.scene.collection.children.link(c)
    g['collections']['19']=c;g['collection']=c
    g['EVIDENCE']='18 October gate complex and reverse route photographs; estimated dimensions'
    gate,mesh,beam,box,cylinder,mat,M=[g[k] for k in ('gate','mesh','beam','box','cylinder','mat','M')]
    ga=g['ga']
    # Distinct names preserve this worn surface through the runtime plaza tiling pass.
    concrete=M['concrete'].copy();concrete.name='G9 entrance weathered cement'
    concrete.diffuse_color=(.34,.335,.305,1)
    concrete.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.96
    repair=mat('entrance old aggregate repair',(.045,.05,.044),.99)
    stain=mat('entrance ingrained stains',(.058,.06,.05),.98)
    joint=mat('entrance hairline cracks',(.022,.025,.020),1)

    def floor(name,points,z,material):
        o=mesh('SITE_GROUND_gate9 '+name,[gate(a,d,z) for a,d in points],
               [tuple(range(len(points)))],material)
        uv=o.data.uv_layers.new(name='Entrance metres')
        for p in o.data.polygons:
            for li in p.loop_indices:
                a,d=points[o.data.loops[li].vertex_index];uv.data[li].uv=(a/4,d/4)
        return o

    # Connected apron: both gates, checking passage exit, right turn and shed lane.
    # Surface sits millimetres above existing paving; no raised thresholds.
    floor('entry concrete apron',[(-19.1,-5),(1.3,-5),(1.3,.9),(16.7,.9),
          (16.7,29),(7.0,29),(7.0,22),(-6,22),(-8,14),(-19.1,4)],.303,concrete)
    floor('right turn connection',[(7,22),(16.7,22),(16.7,33),(7,33)],.303,concrete)
    # Irregular resurfacing at the street-to-concrete transition, not a tiled plaza.
    floor('old road repair',[(-18,-10),(-10,-10.7),(-5,-9.6),(2,-10.3),
          (2,-5.1),(-6,-5.9),(-12,-5.1),(-18,-5.7)],.304,repair)
    rng=random.Random(191018)
    for a,d,rx,ry in [(-15,-3,1.1,.65),(-4,5,1.6,.9),(10,12,1.4,.8),
                       (12,26,1.2,.65),(-9,3,.6,.4),(-2,15,1.1,.5)]:
        points=[(a+math.cos(i*math.tau/15)*rx*rng.uniform(.8,1.12),
                 d+math.sin(i*math.tau/15)*ry*rng.uniform(.8,1.12)) for i in range(15)]
        floor('cement weathering',points,.306,stain)
    for d,a0,a1 in [(-4,-19,1),(5,-8,16.5),(12,-7,16.5),(20,0,16.5),(28,7,16.5)]:
        beam('SITE_GROUND_gate9 concrete construction joint',gate(a0,d,.307),gate(a1,d,.307),.014,joint,.002)
    for a,d in [(-16,-8),(-4,-7),(-3,7),(9,15),(13,27)]:
        points=[(a+i*.65,d+rng.uniform(-.35,.35)) for i in range(6)]
        for p,q in zip(points,points[1:]):
            beam('SITE_GROUND_gate9 irregular surface crack',gate(*p,.308),gate(*q,.308),.018,joint,.002)
    # Flush utility lids with inset surrounds and narrow cast ribs.
    for a,d in [(-15,-8),(-3,12),(12,27)]:
        box('SITE_GROUND_gate9 manhole surround',gate(a,d,.31),(1.05,1.2,.012),stain,ga)
        box('SITE_GROUND_gate9 inset utility cover',gate(a,d,.318),(.88,1.03,.012),M['dark'],ga)
        for off in [-.36,-.18,0,.18,.36]:
            beam('SITE_GROUND_gate9 utility cover rib',gate(a+off,d-.43,.326),gate(a+off,d+.43,.326),.018,M['steel'],.005)
    # Reverse photograph details are attached to the same checking room.
    box('G9 checking room grey electrical box',gate(-7.82,1.05,1.68),(.16,.55,.62),M['steel'],ga)
    box('G9 electrical box inset',gate(-7.72,1.05,1.68),(.025,.43,.49),M['dark'],ga)
    cylinder('G9 inside green bin',gate(-7.52,2.9,.83),.31,1.05,M['green'])
    box('G9 inside bin opening',gate(-7.21,2.9,1.10),(.025,.28,.17),M['dark'],ga)
    # Tapered traffic cone, with a separate pale reflective band.
    orange=mat('traffic cone orange',(.72,.13,.023),.76)
    for z0,z1,r0,r1,material in [(.31,.72,.22,.13,orange),(.72,.90,.13,.09,M['white']),(.90,1.13,.09,.035,orange)]:
        vertices=[gate(-7.52+math.cos(i*math.tau/16)*r,1.3+math.sin(i*math.tau/16)*r,z)
                  for z,r in [(z0,r0),(z1,r1) ] for i in range(16)]
        mesh('G9 traffic cone',vertices,[(i,(i+1)%16,(i+1)%16+16,i+16) for i in range(16)],material)
    box('G9 traffic cone base',gate(-7.52,1.3,.31),(.5,.5,.06),M['dark'],ga)
    cylinder('G9 green water container',gate(16.1,9,.69),.25,.76,M['green'])
    cylinder('G9 water container neck',gate(16.1,9,1.12),.10,.12,M['green'])


def views(views,world):
    for key,p,t,label in [
        ('gate9-approach',(-7,-22,1.9),(-8,0,2.0),'Gate 9 · Photo front'),
        ('gate9-checking-room',(-8.675,-6,1.85),(-8.675,5,1.85),'Gate 9 · Open checking passage'),
        ('gate9-entry-reverse',(-4,13,1.9),(-10,0,2.1),'Gate 9 · Reverse gate view'),
        ('gate9-entry-turn',(-3,8,1.9),(12,21,2.0),'Gate 9 · Right turn'),
        ('gate9-entry-straight',(11,15,1.9),(10,31,2.0),'Gate 9 · Shelter approach'),
        ('gate9-entry-overview',(-31,-35,37),(-1,12,0),'Gate 9 · Entrance layout')]:
        views[key]={'position':world(*p),'target':world(*t),'label':label}

