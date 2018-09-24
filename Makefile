pushall: sync
	git push origin master

prettier:
	prettier --single-quote --write "**/*.js"
