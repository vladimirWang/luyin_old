import axios from 'axios'

const req = axios.create()

req.interceptors.request.use(config => {
    
    return config
})

req.interceptors.response.use(resp => {
    
    return resp.data
})

export default req