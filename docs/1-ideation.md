
| **Primary outcome** | A working end-to-end implementation with production-quality code and documentation     |
| ------------------- | -------------------------------------------------------------------------------------- |
| **Technology**      | Your choice of language, framework, database, and deployment approach                  |
| **Scope guidance**  | Prioritize a coherent vertical slice. Document any capability you intentionally defer. |
*copied from doc*
## Framework
### Frontend
- Something scalable and easy to deploy
- React for portability
### Backend
- Something scalable
- Open question: *should we deploy the frontend and backend separately or in one container*
- ORM for simplicity's sake

## Deployment
- Containerized, easy to do same as development
- db separate
	- For prototyping's sake, can just use an out of the box provider, but obviously would need to pay more attention in the future for hipaa compliance (which we'll punt on)
- redis sidecar likely useful

## Approach
- need solid data model for questionnaire
	- pagination? (i.e. do we want to support a view with multiple pages of quesitons?)
	- how to represent connections between questions
	- what question types to support
		- dropdown
		- multiple choice (square vs circle checkbox)
		- date
			- limits?
		- number
			- units vs dimensionless
			- limits?
		- text
			- short answer, limits
			- other text subtypes, email, address, etc.
	- indicating required questions
		- do we want to have nesting requirements? think through how to represent this
	- somehow map types in question model to responses
- how to handle partially completed state
	- indexeddb probably? look into other browser local storage options
- audit logging, important for seeing who is accessing what and when, particularly important for making changes
- database structure
	- questions separate from answers
	- questions:
		- versioning, need plan for how versions work
			- small detail, need to explicitly plan for conflicts, multiple users updating at once
		- writes being reliable is N* here
		- reads can have some SLA (decide later) for being reflected
	- answers:
		- need to be able to handle high answer throughput
		- write speed and reliability are important
			- maybe have some sort of dual-write system, once to some queue and once to the db itself
		- replication delay for answer ingest is acceptable
		- reading should never be bottlenecked by writing
		- scale is going to be larger than questions
	- audit db???
		- needs more fleshing out
- logging/insights
	- need to figure out framework for this
		- like the structure of `requests`, `dependencies`, `traces`, `exceptions`
		- look into existing structure patterns/frameworks for this

### Things to punt on
- handling sharding
- auth? can maybe get some sort of oath prototype, but low priority, most important thing is getting an access *model* in place before worrying about specifics (can assume that some other infra exists around this already?)
	- should definitely indicate where data barriers are and how those will be enforced
- frontdoor/ddos protection/rate limiting
	- lots of out of the box solutions here
	- can make note of what 