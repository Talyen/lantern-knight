"""Blender 5.2.2 LTS editable rigid-part male proxy and deterministic RGBA export.
Game (X,Y,Z) = Blender (X,Z,-Y). Anatomical sword RIGHT, lantern LEFT.
Only d45 walk/attack is an animation sample; turnaround stills are disposable calibration.
"""
import bpy, math, json, os
from mathutils import Vector

ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKSPACE=os.environ.get('LANTERN_ASSET_WORKSPACE')
if not WORKSPACE:raise RuntimeError('Proxy export requires an external authoring workspace')
C=json.load(open(os.path.join(ROOT,'src/content/camera.json')))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x,scene.render.resolution_y=C['canvas'];scene.render.resolution_percentage=100
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8'
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.fps=60
scene.world.color=(0.15,0.15,0.15)
def mat(name,color,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*color,1);n.inputs['Roughness'].default_value=1
    if emission:n.inputs['Emission Color'].default_value=(*color,1);n.inputs['Emission Strength'].default_value=emission
    return m
cloth=mat('oxblood-cloth',(0.24,0.065,0.08));dark=mat('ink-leather',(0.045,0.07,0.09));skin=mat('warm-male-face',(0.54,0.31,0.2));steel=mat('pale-steel',(0.39,0.6,0.57));brass=mat('lantern-brass',(0.43,0.25,0.06));glow=mat('warm-flame',(1,0.53,0.12),1);hair=mat('cropped-hair',(0.055,0.037,0.033))
rig=bpy.data.objects.new('KNIGHT_ground_root',None);scene.collection.objects.link(rig)
rig['status']='EDITABLE PROXY; camera, design and animation approval pending'
rig['equipment']='sword anatomical right (+X); lantern anatomical left (-X)'
def cube(name,loc,scale,material,parent=rig):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(material);o.parent=parent;return o
def ball(name,loc,scale,material):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(material);o.parent=rig;return o
def rod(name,start,end,radius,material):
    mid=(Vector(start)+Vector(end))/2
    bpy.ops.mesh.primitive_cylinder_add(vertices=5,radius=radius,depth=(Vector(end)-Vector(start)).length,location=mid)
    o=bpy.context.object;o.name=name;o.rotation_euler=(Vector(end)-Vector(start)).to_track_quat('Z','Y').to_euler();o.data.materials.append(material);o.parent=rig;o['rest_length']=(Vector(end)-Vector(start)).length;return o
torso=ball('slender_coat',(0,0,1.11),(0.235,0.14,0.35),cloth)
belt=cube('belt',(0,0,0.94),(0.39,0.27,0.065),dark)
head=ball('male_face',(0,-0.025,1.62),(0.117,0.112,0.17),skin)
hair_obj=ball('cropped_hair',(0,0.015,1.72),(0.125,0.11,0.09),hair)
nose=ball('nose',(0,-0.124,1.62),(0.04,0.04,0.033),skin)
pauldron=ball('single_small_brass_shoulder',(0.23,0,1.34),(0.11,0.105,0.09),brass)
# Short split coattails with a deliberately narrow silhouette.
tails=[cube('coattail_left',(-0.105,0.1,0.82),(0.17,0.06,0.34),cloth),cube('coattail_right',(0.105,0.1,0.82),(0.17,0.06,0.34),cloth)]
parts=[]
for side in [-1,1]:
    parts.append([rod('thigh_%s'%side,(side*.12,0,.87),(side*.12,0,.5),.075,dark),rod('shin_%s'%side,(side*.12,0,.5),(side*.12,0,.09),.06,dark),cube('boot_%s'%side,(side*.12,-.055,.065),(.145,.24,.13),dark)])
arms=[]
for side in [-1,1]:arms.append([rod('upper_arm_%s'%side,(side*.235,0,1.32),(side*.30,-.03,1.08),.065,cloth),rod('forearm_%s'%side,(side*.30,-.03,1.08),(side*.31,-.13,.98),.05,skin),ball('hand_%s'%side,(side*.31,-.13,.98),(.06,.05,.06),skin)])
sword_pivot=bpy.data.objects.new('sword_RIGHT_grip',None);scene.collection.objects.link(sword_pivot);sword_pivot.parent=rig
blade=cube('sword_blade',(0,0,.4),(.065,.025,.74),steel,sword_pivot)
guard=cube('sword_guard',(0,0,.025),(.22,.045,.04),brass,sword_pivot)
grip=cube('sword_grip',(0,0,-.05),(.035,.035,.15),dark,sword_pivot)
lantern_pivot=bpy.data.objects.new('lantern_LEFT_socket',None);scene.collection.objects.link(lantern_pivot);lantern_pivot.parent=rig
for name,loc,scale,material in [('case',(0,0,-.14),(.17,.12,.21),brass),('flame',(0,-.066,-.14),(.09,.012,.13),glow),('top',(0,0,-.02),(.22,.16,.035),dark),('handle',(0,0,.035),(.08,.035,.08),brass)]:cube('lantern_'+name,loc,scale,material,lantern_pivot)
def orient_rod(o,a,b):
    a,b=Vector(a),Vector(b);o.location=(a+b)/2;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.scale.z=(b-a).length/o['rest_length']
def leg(side,phase,bob,objects):
    phase%=1
    if phase<.5:y=-.36+phase*1.44;z=.065
    else:
        p=(phase-.5)*2;y=.36-.72*(p*p*(3-2*p));z=.065+.18*math.sin(math.pi*p)
    hip=Vector((side*.12,0,.82+bob));foot=Vector((side*.12,y,z+.04));delta=foot-hip;dist=delta.length
    upper,lower=.40,.42
    along=(upper*upper-lower*lower+dist*dist)/(2*dist)
    bend=math.sqrt(max(0,upper*upper-along*along))
    perpendicular=Vector((0,delta.z,-delta.y)).normalized()
    knee=hip+delta.normalized()*along+perpendicular*bend
    assert abs((knee-hip).length-upper)<1e-6 and abs((foot-knee).length-lower)<1e-6, 'leg reach/length invariant'
    orient_rod(objects[0],hip,knee);orient_rod(objects[1],knee,foot);objects[2].location=(side*.12,y-.055,z)
def pose(clip,t):
    cyc=t/.8;bob=.022*(1-math.cos(4*math.pi*cyc)) if clip=='walk' else 0
    for o in [torso,belt,head,hair_obj,nose,pauldron,*tails]:o.location.z=o.get('base_z',o.location.z)+bob
    if clip=='walk':
        leg(-1,cyc+.5,bob,parts[0]);leg(1,cyc,bob,parts[1])
        swing=math.sin(2*math.pi*cyc)
        hands=[Vector((-.31,-.10+.06*swing,1.0+bob)),Vector((.31,-.10-.13*swing,1.0+bob))]
        sword_pivot.rotation_euler=(math.radians(-20),math.radians(-20),0)
    else:
        leg(-1,.22,bob,parts[0]);leg(1,.22,bob,parts[1])
        # Anticipation -> fast readable strike at 167 ms -> recovery. Root remains fixed.
        if t<.167:k=t/.167;angle=math.radians(-35-100*k);hand=Vector((.31,-.02,1.03+.36*k))
        elif t<.25:k=(t-.167)/.083;angle=math.radians(-135+225*k);hand=Vector((.31,-.02-.44*k,1.39-.28*k))
        else:k=min(1,(t-.25)/.35);angle=math.radians(90-110*k);hand=Vector((.31,-.46+.36*k,1.11-.11*k))
        sword_pivot.rotation_euler=(angle,math.radians(-20),0);hands=[Vector((-.31,-.13,1.0)),hand]
    for i,side in enumerate([-1,1]):
        shoulder=Vector((side*.235,0,1.32+bob));hand=hands[i];delta=hand-shoulder;distance=delta.length;upper=lower=.27
        along=(upper*upper-lower*lower+distance*distance)/(2*distance);bend=math.sqrt(max(0,upper*upper-along*along))
        normal=delta.normalized();perp=Vector((side,.4,0));perp=(perp-normal*perp.dot(normal)).normalized()
        elbow=shoulder+normal*along+perp*bend
        assert abs((elbow-shoulder).length-upper)<1e-6 and abs((hand-elbow).length-lower)<1e-6, 'arm reach/length invariant'
        orient_rod(arms[i][0],shoulder,elbow);orient_rod(arms[i][1],elbow,hand);arms[i][2].location=hand
    sword_pivot.location=hands[1];lantern_pivot.location=hands[0]
    for o in [*bpy.data.objects]:
        if o.parent==rig:o.keyframe_insert(data_path='location');o.keyframe_insert(data_path='rotation_euler');o.keyframe_insert(data_path='scale')
for o in [torso,belt,head,hair_obj,nose,pauldron,*tails]:o['base_z']=o.location.z
a=math.radians(C['azimuthDeg']);e=math.radians(C['elevationDeg'])
out=Vector((math.sin(a)*math.cos(e),-math.cos(a)*math.cos(e),math.sin(e)))
right=Vector((math.cos(a),math.sin(a),0));up=out.cross(right)
target=up*((C['anchor'][1]-C['canvas'][1]/2)/C['sourceDensity'])
bpy.ops.object.camera_add(location=target+out*10);camera=bpy.context.object;camera.name='CANONICAL_camera_v1';camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=C['canvas'][1]/C['sourceDensity'];scene.camera=camera
for name,loc,energy,size in [('key',(3,-4,6),450,5),('fill',(-3,-1,4),220,4)]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
outdir=os.path.join(WORKSPACE,'staging/proxy');os.makedirs(outdir,exist_ok=True)
frames=[];clips={};rig.rotation_euler.z=math.pi/4
samples={'walk':([i*.1 for i in range(8)],[100]*8,True),'attack_sword_01':([0,.1,.167,.2,.25,.35,.45,.55],[100,67,33,50,100,100,100,50],False)}
for clip,(times,durations,loop) in samples.items():
    ids=[]
    for i,t in enumerate(times):
        scene.frame_set((1 if clip=='walk' else 100)+round(t*60));pose(clip,t)
        fid='proxy-'+clip+'-d45-'+str(i);ids.append(fid);filename='proxy/'+fid+'.png';scene.render.filepath=os.path.join(WORKSPACE,'staging',filename);bpy.ops.render.render(write_still=True)
        p=rig.matrix_world @ lantern_pivot.location
        offset=p-target;socket=[C['canvas'][0]/2+offset.dot(right)*C['sourceDensity'],C['canvas'][1]/2-offset.dot(up)*C['sourceDensity']]
        frames.append({'id':fid,'path':filename,'origin':'blender-proxy','attachments':{'lantern':socket}})
    clips[clip]={'frames':ids,'durationsMs':durations,'loop':loop,'notifies':[{'id':'step-right','atMs':1,'kind':'footstep'},{'id':'step-left','atMs':401,'kind':'footstep'}] if loop else [{'id':'swing','atMs':167,'kind':'whoosh'}]}
# Eight stills are a proxy turnaround for review, not eight-direction animation production.
scene.frame_set(1);pose('walk',0)
for i in range(8):
    rig.rotation_euler.z=i*math.pi/4;scene.render.filepath=os.path.join(WORKSPACE,'authoring/knight','turnaround_d%02d.png'%(i*45));bpy.ops.render.render(write_still=True)
rig.rotation_euler.z=math.pi/4
scene.frame_start=1;scene.frame_end=148
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORKSPACE,'authoring/knight/rig.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(WORKSPACE,'public/calibration-proxy.glb'),export_format='GLB',export_animations=False)
json.dump({'contractId':C['id'],'bakeVersion':C['bakeVersion'],'recipe':'blender-proxy-v2-constant-limbs','tool':'Blender '+bpy.app.version_string,'axisMap':'game(X,Y,Z)=blender(X,Z,-Y)','status':'proxy','speedWorldUnitsPerSecond':1.8,'limbLengths':{'thigh':.40,'shin':.42,'upperArm':.27,'forearm':.27},'frames':frames,'clips':clips},open(os.path.join(outdir,'export.json'),'w'),indent=2)
print('LANTERN_EXPORT_OK: editable rig, 16 d45 frames and 8 turnaround stills')
