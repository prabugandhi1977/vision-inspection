# Vision inspection production application — intent

## Purpose

Build a production-ready vision-inspection application for automated quality inspection of manufactured components. The application acquires images from industrial cameras, runs configurable inspection algorithms, determines PASS/FAIL results, records immutable inspection data, and offers real-time production monitoring and historical analysis.

It is a production quality-control system, not simply an image-processing program. The priority order is correct result, traceability, reliability, safety, performance, and usability.

## Users and access

| Role | Primary capabilities |
| --- | --- |
| Operator | Log in, select/confirm a model, start/stop inspection, view live results, statistics, rejected parts, and acknowledge alarms. Cannot change critical parameters. |
| Quality engineer | Create and review inspection programs, parameters, criteria, images, and defect history. |
| Production engineer | Configure models, stations, recipes, and monitor machine performance. |
| Administrator | Manage users, permissions, cameras, hardware interfaces, settings, logs, and backup/restore. |

Permissions are defined by function (for example `RunInspection`, `ModifyRecipe`, `ApproveRecipe`, `ConfigureCamera`, and `ViewReports`) rather than merely by screen.

## Inspection cycle

1. Detect arriving part and receive PLC trigger.
2. Mark vision busy and acquire the configured camera image.
3. Validate and pre-process the image, then run each enabled inspection step.
4. Aggregate step results as `PASS`, `FAIL`, `ERROR`, or `SKIPPED`.
5. Send the overall result and complete signal to the PLC.
6. Accept or reject the part, persist the result and image reference, and update the dashboard.

The system must never silently report PASS when camera, communication, image acquisition, storage, or processing has failed.

## Functional scope

- Camera abstraction for connection, trigger, acquisition, configuration, diagnostics, and status without vendor coupling.
- PLC interface for trigger, busy, complete, PASS, FAIL, error, reset, alarms, and recipe/model selection.
- Versioned recipes containing product, camera and lighting configuration, ROIs, inspection steps, thresholds, tolerances, PLC settings, and approval state.
- Extensible inspections: presence/absence, measurement, pattern matching, surface defects, OCR/OCV, color, position, and orientation.
- Production dashboard showing order, model, counts, yield, cycle time, hardware status, alarms, live image, and recent results.
- Full traceability from part through inspection, image, recipe version, individual results, and system status.
- Alarm management, reporting, audit trail, session management, and role-based access control.

## Data and retention

Every completed inspection retains: inspection ID, part ID, production order, model, station, timestamp, operator, recipe version, overall and individual results, cycle time, image reference, and system status. Records are immutable except through controlled, audited correction processes.

Store images outside the primary database and persist their path/reference. Image retention must be configurable (for example, PASS 7 days and FAIL 90 days); it must never be hard-coded.

## Safety, reliability, and quality constraints

- Hardware-specific code is isolated behind camera and PLC interfaces.
- Production configuration is externalized; development, test, and production settings are separate.
- Communication, acquisition, processing, storage, low-disk, invalid-recipe, and emergency failures generate actionable alarms, logs, and safe machine signaling.
- Network/database failures may use local buffering where appropriate; they must not lose or falsify a result.
- Record actual inspection cycle time. Initial targets: inspection response below 500 ms, UI response below 200 ms, and availability above 99%; final limits depend on equipment and machine cycle time.
- Critical changes (recipe, threshold, hardware, configuration, role) require authorization and audit records containing timestamp, user, action, object, old value, new value, and reason.

## Architecture and delivery

Use presentation, application, domain, infrastructure, and hardware/external-system layers. Treat AI models as versioned inspection components and record model name/version, confidence, result, and execution time.

Definition of done includes functional UI, failure handling, logging, permissions, database changes, unit and integration coverage, production simulations (PASS, FAIL, missing part, camera/PLC/network failure, timeout, invalid recipe), and current documentation.
