# Pliable Roadmap

A lightweight list of milestones to guide Pliable's growth. Not a strict plan — just a starting point for discussion. If you think the order should change or something is missing, open an issue.

## We're Looking For

If you have experience with direct modeling in tools like Plasticity, Spaceclaim, NX Synchronous, Rhino, or the Blender CAD Sketcher/CAD Transform plugins, your input on workflows and UX conventions would be invaluable — even if you're not a developer. Open an issue and start a conversation.

## Milestones (ordered)

**1. Architecture Refactor**
The current structure was built to get the first tools working, not to scale. This needs to happen before significant new contributions begin. Goal is a clean tool API and clear separation between UI, interaction, and geometry logic — something that can realistically support 100+ tools.

**2. Onscreen Interactive Dimensions**
Currently tool input relies on dialog boxes. The goal is Plasticity-style onscreen dimension display during operations, with Tab to enter an exact value. This needs to exist before new tools are added so every tool benefits from it consistently rather than retrofitting later.

**3. Direct Modeling Tool Expansion**
With architecture clean and input interaction consistent, this is where momentum builds. These tools all target the core use case of editing imported STEP geometry and don't require an attachment or placement system:
- Push/pull stretch (neighboring faces deform rather than extrude)
- Uniform and directional scale
- Shell / offset face
- Draft angle
- Defeature / remove face

**4. Attachment / Placement System**
Many future features depend on this. A reliable way to define where an object lives in 3D space and position it relative to faces, edges, or points.

**5. Transform Widget**
Move and rotate solids in the viewport. Goes hand-in-hand with attachment.

**6. 3D Primitives**
Only meaningful once attachment and transform exist so they can be accurately positioned.

**7. Sketching System**
Long-term. Sketch plane definition, basic constraints, profiles for extrude/revolve/sweep. The most complex milestone by far.

## Future Ideas (unordered)
- Additional import/export formats
- Plugin system
- Performance pass

## Contributing
Before starting work on anything significant, please comment on the relevant issue or open one. Active work should be signaled by a draft PR or issue comment. This helps avoid conflicts from parallel efforts, especially during the architecture refactor phase.
