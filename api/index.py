from urllib.parse import parse_qsl, urlencode, urlsplit

from server import Handler


class handler(Handler):
    @property
    def origin(self):
        return 'https://' + self.headers.get('Host', '')

    def do_GET(self):
        self.route_api()

    def do_POST(self):
        self.route_api()

    def route_api(self):
        url = urlsplit(self.path)
        query = dict(parse_qsl(url.query))
        route = query.pop('_route', None)
        if route:
            self.path = '/api/' + route
            if query:
                self.path += '?' + urlencode(query)
        self.run_api()
